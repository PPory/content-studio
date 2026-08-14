// 任务1 · 即时初筛：灵感库「待初筛」→ LLM 判断价值 + 提炼素材卡 → 素材库。
// 子项先按稳定任务标识 upsert，全部补齐后才改灵感终态；失败进入人工复核，重跑不重复建素材。

import { TRIAGE_PROMPT } from "../prompts.js";
import { chatJson } from "../lib/llm.js";
import { fetchArticle } from "../lib/reader.js";
import {
  assertGroundedGeneratedText,
  findSpecificPersonalClaims,
  stableTaskKey,
  verificationForMaterial,
} from "../lib/integrity.js";
import {
  getRow, updateRow, listByStatus, upsertByTaskKey, setTags,
} from "../lib/db.js";
import {
  normMaterialType, INBOX_STATUS, VALUE_JUDGMENT, STATUS_BY_VALUE,
} from "../lib/values.js";
import { isVaultEnabled, archiveInbox, archiveMaterial, tryArchive } from "../lib/vault.js";

const TRIAGE_BATCH = 3;      // 每轮最多处理条数
const MATERIALS_CAP = 6;     // 每条灵感最多建素材卡数

export async function listPendingTriage(env, pageSize = TRIAGE_BATCH) {
  return listByStatus(env, "inbox", INBOX_STATUS.PENDING, Math.min(pageSize, TRIAGE_BATCH));
}

export async function runTriage(env) {
  const rows = await listPendingTriage(env);
  console.log(`triage: ${rows.length} item(s) pending`);

  for (const row of rows) {
    try {
      await triageOne(env, row);
    } catch (e) {
      console.error(`triage failed for ${row.id}:`, e.message);
      await markFailed(env, row.id, e).catch((e2) => console.error("failed to mark failure:", e2.message));
    }
  }
}

export async function runTriagePageById(env, id) {
  const row = await getRow(env, "inbox", id);
  if (!row || row.status !== INBOX_STATUS.PENDING) {
    return { skipped: true, reason: "not_pending", id };
  }
  try {
    return await triageOne(env, row);
  } catch (e) {
    await markFailed(env, id, e).catch((e2) => console.error("failed to mark failure:", e2.message));
    throw e;
  }
}

function markFailed(env, id, error) {
  return updateRow(env, "inbox", id, {
    status: INBOX_STATUS.FAILED,
    verdict: `自动初筛出错：${error.message.slice(0, 300)}`,
  });
}

async function triageOne(env, row) {
  // 链接类先抓外部正文；非链接类的正文就在 body 列上——原来这里要多打一次
  // `/blocks/{id}/children` 把 Notion 块读回纯文本，现在查行时已经带回来了。
  let body = "";
  let fetchedTitle = "";
  let fetchedSourceText = "";
  if (row.link && (row.kind === "文章链接" || row.kind === "视频链接")) {
    const article = await fetchArticle(row.link, env);
    if (article.ok) {
      body = article.body;
      fetchedSourceText = article.body;
      fetchedTitle = article.title;
    } else {
      body = `（正文抓取失败：${article.reason}）`;
    }
  } else {
    body = row.body || "";
  }

  const { json } = await chatJson(env, {
    system: TRIAGE_PROMPT,
    user: JSON.stringify({ 类型: row.kind, 一句话原文: row.title, 正文: body, 来源: row.source, 链接: row.link }),
    maxTokens: 8000,
  });

  const sourceText = [row.title, body].filter(Boolean).join("\n");
  // 只有直接输入的「想法」可作为作者本人的经历证据；外部文章里的第一人称属于原作者，
  // 不能被模型借来改写成用户的“我”。
  const evidence = row.kind === "想法" && findSpecificPersonalClaims(sourceText).length
    ? [{ type: "个人经历", note: sourceText }]
    : [];
  assertGroundedGeneratedText({
    oneLine: json.one_line,
    materials: json.materials,
    card: json.card_markdown,
  }, evidence);

  // 状态按价值分流：失败信号读 LLM 的 status，其余一律由 value 决定（value 是分流的唯一真源）。
  const failed = json.status === INBOX_STATUS.FAILED;
  const status = failed ? INBOX_STATUS.FAILED : (STATUS_BY_VALUE[json.value] || INBOX_STATUS.ARCHIVED);
  const fields = {
    status,
    value_judgment: VALUE_JUDGMENT[json.value] || "存档备用",
    verdict: json.one_line || "",
  };
  // 链接类条目标题若还是裸 URL：优先用抓到的文章标题，抓不到则用初筛「一句话判断」兜底，
  // 避免灵感库里一排裸链接看不出内容。
  if (/^https?:\/\//i.test(row.title)) {
    const better = fetchedTitle || (json.one_line || "").trim();
    if (better) fields.title = better.slice(0, 200);
  }

  const tags = Array.isArray(json.tags) ? json.tags.slice(0, 8) : [];

  // 只有高价值(待选题)才产素材卡；失败/中/低不产。worth_material 由 LLM 仅对高价值置 true。
  if (failed || !json.worth_material) {
    await updateRow(env, "inbox", row.id, fields);
    if (tags.length) await setTags(env, "inbox", row.id, tags);
    return { id: row.id, status, materials: 0 };
  }

  const materials = (json.materials || []).slice(0, MATERIALS_CAP);
  let materialCount = 0;
  const newMaterials = [];
  for (const [index, m] of materials.entries()) {
    if (!m?.title || !m?.note) continue;
    const matType = normMaterialType(m.type);
    const llmSourceUrl = /^https?:\/\//i.test(m.source || "") ? m.source : "";
    // 只有模型给出的出处与本次实际抓取的原始链接完全一致时，才能把原文正文拿来逐字核验。
    // 否则宁可保留「待核验」，不能把任意 m.source 偷换成父灵感链接后误判为已核验。
    const sourceUrl = llmSourceUrl || row.link;
    const comparableSource = sourceUrl && row.link && sourceUrl === row.link ? fetchedSourceText : "";
    const verification = verificationForMaterial({
      type: matType,
      note: m.note,
      sourceUrl,
      sourceText: comparableSource,
      origin: "auto-extract",
    });
    const saved = await upsertByTaskKey(
      env,
      "materials",
      stableTaskKey("triage-material", row.id, index),
      {
        title: m.title.slice(0, 200),
        type: matType,
        content: m.note,
        source_url: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : "",
        inbox_id: row.id,
        verification: verification.status,
        verification_note: verification.note,
      }
    );
    if (tags.length && saved.created) await setTags(env, "material", saved.id, tags);
    if (saved.created) {
      newMaterials.push({
        id: saved.id, title: m.title.slice(0, 200), type: matType, content: m.note,
        source_url: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : "",
        verification: verification.status, created_at: row.created_at,
      });
    }
    materialCount++;
  }

  // 素材卡进自己的列，不再追加进正文。
  //
  // 原来它要跟正文挤在一起，还得先把整页正文读回来查「系统任务标识：xxx」这行标记
  // 才知道追加过没有——那行系统噪音是用户能在页面上看到的。现在覆盖写同一列，
  // 天然幂等，也不用再往内容里埋标记。
  if (json.card_markdown) fields.card_markdown = json.card_markdown;

  // 所有子项完成后再改终态；任一上游写入失败都会落到「初筛失败/需人工」。
  await updateRow(env, "inbox", row.id, fields);
  if (tags.length) await setTags(env, "inbox", row.id, tags);

  // 归档进 vault。**放在状态改完之后**：vault 是归档不是真源，写它失败不该让
  // 一条已经初筛好的灵感回到「待初筛」被重跑一遍（那会再烧一次 LLM）。
  await archiveTriaged(env, { ...row, ...fields }, newMaterials, tags);

  console.log(`triage ok: ${row.id} -> ${status}, ${materialCount} material(s)`);
  return { id: row.id, status, materials: materialCount };
}

// 灵感原文 + 新建的素材卡写进 vault，并把路径回写 D1。
// 已弃用的灵感不写——那是明确判过没价值的，进 vault 纯噪音。
async function archiveTriaged(env, row, newMaterials, tags) {
  if (!isVaultEnabled(env) || row.status === INBOX_STATUS.DROPPED) return;

  const inboxPath = await tryArchive("inbox", () => archiveInbox(env, row, { tags }));
  if (inboxPath) await updateRow(env, "inbox", row.id, { vault_path: inboxPath });

  for (const m of newMaterials) {
    const path = await tryArchive("material", () =>
      archiveMaterial(env, m, { tags, inboxTitle: row.title }));
    if (path) await updateRow(env, "materials", m.id, { vault_path: path });
  }
}
