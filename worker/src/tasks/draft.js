// 任务3 · 成稿：选题「撰写中」→ 只为主平台生成一篇完整初稿 → 稿件库（待修改），
// 选题状态改「已成稿」。一次只处理 1 个选题。
//
// 平台选择：只取选题 platform 的值作为主平台。其他平台需要时从已完成主稿另行适配。
// 素材：主料=选题关联素材；补充料=按标签检索素材库的相关素材（打分排序取前 N），
//   一起拼进 prompt，注明主／辅，让模型以核心为主、补充为辅。
//
// 并发与幂等：Workflow 以确定性实例 ID 防并发；每篇稿件再按 task_key 的 UNIQUE 约束兜底。
// 目标平台确实有稿才改「已成稿」；失败进入「搁置」，不会出现空选题被误标完成。

import { draftPrompt } from "../prompts.js";
import { chatJson } from "../lib/llm.js";
import { assertGroundedGeneratedText, isMaterialEligibleForDraft, primaryPlatform, stableTaskKey } from "../lib/integrity.js";
import {
  getRow, updateRow, listByStatus, upsertByTaskKey,
  materialsOfTopic, draftsOfTopic, searchSupplementary, tagsOf, findTopicByTitle, personalEvidence,
} from "../lib/db.js";
import { TOPIC_STATUS, DRAFT_STATUS, PLATFORMS } from "../lib/values.js";
import { isVaultEnabled, archiveDraft, tryArchive } from "../lib/vault.js";

const DRAFT_MAX_TOKENS = 16000; // 单平台单稿，16k 足够
const SUPP_CAP = 12;            // 补充检索素材上限

export { PLATFORMS };

const PLATFORM_ALIASES = { x: "X", youtube: "YouTube", yt: "YouTube" };

// Telegram /成稿 传入的平台名容错归一（大小写/别名）
export function normalizePlatform(s) {
  const k = (s || "").trim();
  if (!k) return "";
  if (PLATFORMS.has(k)) return k;
  return PLATFORM_ALIASES[k.toLowerCase()] || "";
}

// Telegram /成稿 按关键词匹配选题
export async function findTopicByKeyword(env, keyword) {
  return findTopicByTitle(env, keyword);
}

// cron 路径：领取一个「撰写中」选题
export async function runDraft(env) {
  const topics = await listByStatus(env, "topics", TOPIC_STATUS.WRITING, 1);
  if (!topics.length) return;
  return draftTopic(env, topics[0]);
}

// Workflow 按选题 ID 执行；如果排队期间用户改了状态，就不再偷偷成稿。
export async function runDraftPageById(env, topicId) {
  const topic = await getRow(env, "topics", topicId);
  if (!topic || topic.status !== TOPIC_STATUS.WRITING) {
    return { title: topic?.title || "", created: [], skipped: [], failed: [], reason: "not_writing" };
  }
  return draftTopic(env, topic);
}

// Telegram /成稿 路径：对指定选题按指定平台成稿（覆盖 platform 字段）
export async function runDraftForTopic(env, topic, platformsOverride) {
  const fresh = await getRow(env, "topics", topic.id);
  return draftTopic(env, fresh, platformsOverride);
}

// 核心成稿流程。platformsOverride 为空则用选题自己的 platform。
// 返回 { title, created[], skipped[], failed[], reason? } 供命令回执。
async function draftTopic(env, topic, platformsOverride) {
  const title = topic.title;
  const requested = (platformsOverride && platformsOverride.length ? platformsOverride : [topic.platform])
    .filter((p) => PLATFORMS.has(p));
  const mainPlatform = primaryPlatform(requested);

  if (!mainPlatform) {
    await updateRow(env, "topics", topic.id, {
      status: TOPIC_STATUS.PARKED,
      draft_note: "⚠️ 适配平台为空，未生成初稿。请填好平台后把状态改回「撰写中」。",
    });
    console.log(`draft: topic "${title}" has no platform`);
    return { title, created: [], skipped: [], failed: [], reason: "no_platforms" };
  }

  // 命令临时指定了别的平台时，把它写回选题——否则下一轮 cron 还会按旧值再跑一遍
  if (topic.platform !== mainPlatform) {
    await updateRow(env, "topics", topic.id, { platform: mainPlatform });
  }

  // 主料：选题关联素材，一次 JOIN 取回
  const allCore = await materialsOfTopic(env, topic.id);
  const coreMaterials = allCore.filter((m) =>
    isMaterialEligibleForDraft({ type: m.type, verificationStatus: m.verification })
  );
  const coreIds = allCore.map((m) => m.id);
  const coreTagMap = await tagsOf(env, "material", coreMaterials.map((m) => m.id));
  const coreInput = coreMaterials.map((m) => ({
    title: m.title,
    type: m.type,
    note: m.content,
    tags: coreTagMap.get(m.id) || [],
    verificationStatus: m.verification,
  }));

  // 补充料：按主料标签检索，SQL 里打分排序，不再整批拉回来本地算
  const coreTags = [...new Set([...coreTagMap.values()].flat())];
  const suppRows = await searchSupplementary(env, {
    coreIds,
    tags: coreTags,
    text: `${title} ${topic.viewpoint}`,
    limit: SUPP_CAP,
  });
  const suppTagMap = await tagsOf(env, "material", suppRows.map((m) => m.id));
  const suppInput = suppRows.map((m) => ({
    title: m.title,
    type: m.type,
    note: m.content,
    tags: suppTagMap.get(m.id) || [],
    verificationStatus: m.verification,
  }));
  console.log(`draft: "${title}" 主料 ${coreInput.length} 条，补充料 ${suppInput.length} 条`);

  // 防重：该平台已有稿就不重复生成
  const existing = await draftsOfTopic(env, topic.id);
  if (existing.some((d) => d.platform === mainPlatform)) {
    await updateRow(env, "topics", topic.id, { status: TOPIC_STATUS.DRAFTED });
    console.log(`draft: "${title}" already drafted for ${mainPlatform}`);
    return { title, created: [], skipped: [mainPlatform], failed: [] };
  }

  console.log(`draft: "${title}" -> ${mainPlatform}`);
  let d;
  let note = "";
  try {
    ({ d, note } = await generate(env, {
      title, viewpoint: topic.viewpoint, audience: topic.audience, coreInput, suppInput,
    }, mainPlatform));
  } catch (e) {
    console.error(`draft: ${mainPlatform} failed for "${title}":`, e.message.slice(0, 300));
    await updateRow(env, "topics", topic.id, {
      status: TOPIC_STATUS.PARKED,
      draft_note: `⚠️ ${mainPlatform} 本次生成失败：${e.message.slice(0, 300)}。把状态改回「撰写中」可重试。`,
    });
    return { title, created: [], skipped: [], failed: [mainPlatform], reason: "all_failed" };
  }

  const saved = await upsertByTaskKey(env, "drafts", stableTaskKey("draft-platform", topic.id, mainPlatform), {
    topic_id: topic.id,
    headline: (d.headline || title).slice(0, 200),
    summary: d.summary || "",
    body: buildDraftBody(d),
    platform: mainPlatform,
    status: DRAFT_STATUS.TODO,
  }, {
    // 你手改过的这三样不能被重跑盖回去
    preserve: ["status", "headline", "summary"],
  });

  // 稿件归档进 vault——这一篇之后全是人在读在改，Obsidian 才是它该待的地方。
  // frontmatter 里只写**真实引用**的素材（主料），补充检索来的不写：把「检索到过」
  // 和「真的用了」混进同一条反链，关系图就失去意义了。
  if (saved.created && isVaultEnabled(env)) {
    const path = await tryArchive("draft", () => archiveDraft(env, {
      id: saved.id, topic_id: topic.id, headline: (d.headline || title).slice(0, 200),
      summary: d.summary || "", body: buildDraftBody(d), platform: mainPlatform,
      status: DRAFT_STATUS.TODO, created_at: Math.floor(Date.now() / 1000),
    }, {
      topicTitle: title,
      materialTitles: coreMaterials.map((m) => m.title),
    }));
    if (path) await updateRow(env, "drafts", saved.id, { vault_path: path });
  }

  // 修改提示写回选题。原来这要把整页正文读回来查任务标识再追加，现在是一列，覆盖即可。
  await updateRow(env, "topics", topic.id, {
    status: TOPIC_STATUS.DRAFTED,
    draft_note: note ? `✍️ 人工修改提示\n\n${note}` : "",
  });

  console.log(`draft: "${title}" done, ${saved.created ? "created" : "reused"} ${mainPlatform}`);
  return { title, created: [mainPlatform], skipped: saved.created ? [] : [mainPlatform], failed: [] };
}

// 生成一个平台的初稿（DRAFT_PROMPT，主料 + 补充料）
async function generate(env, ctx, platform) {
  const { title, viewpoint, audience, coreInput, suppInput } = ctx;
  const { json } = await chatJson(env, {
    system: draftPrompt(platform),
    user: JSON.stringify({
      选题标题: title,
      核心观点: viewpoint,
      目标读者: audience,
      适配平台: [platform],
      核心关联素材: coreInput,
      补充检索素材: suppInput,
      说明: "「核心关联素材」是本篇的主要依据，请优先使用；「补充检索素材」是按标签检索来的相关素材，仅作补充佐证，不要喧宾夺主。",
    }),
    maxTokens: DRAFT_MAX_TOKENS,
    task: "draft",
  });
  const d = (json.drafts || [])[0];
  if (!d?.body_markdown) throw new Error("empty draft in LLM output");
  const note = json.review_note || "";
  // 证据集**不能**就用上面这两批：稿子日后在工作台被重新审计时用的是 `personalEvidence`，
  // 两边口径不一样的话，写的时候放行、打开就报「缺真实素材支撑」。见 db.js 里的说明。
  assertGroundedGeneratedText({ draft: d, reviewNote: note }, await personalEvidence(env, [...coreInput, ...suppInput]));
  return { d, note };
}

// /成稿 的 Telegram 回执文案（webhook 受理、JobWorkflow 完成后各自取用）
export function formatDraftResult(r) {
  if (r.reason === "not_writing") return `「${r.title}」已不在“撰写中”，本次排队任务已跳过。`;
  if (r.reason === "no_platforms") return `「${r.title}」适配平台为空，未生成。`;
  const bits = [];
  if (r.created.length) bits.push(`已生成 ${r.created.join("、")}`);
  if (r.skipped.length) bits.push(`已有跳过 ${r.skipped.join("、")}`);
  if (r.failed.length) bits.push(`失败 ${r.failed.join("、")}`);
  const head = r.reason === "all_failed" ? "❌" : r.reason === "partial_failed" ? "⚠️" : "✅";
  return `${head}「${r.title}」成稿：${bits.join("；") || "无变化"}。稿件库状态=待修改。`;
}

function buildDraftBody(d) {
  let md = d.body_markdown || "";
  if (Array.isArray(d.alt_headlines) && d.alt_headlines.length) {
    md += `\n\n---\n\n**备选标题**\n\n${d.alt_headlines.map((h) => `- ${h}`).join("\n")}`;
  }
  return md;
}
