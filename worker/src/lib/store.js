// 存素材 / 存灵感库的唯一实现。Telegram 命令（telegram.js）与工作台入库（workbench.js）
// 都调这里，各自只负责输入解析和回执格式。
//
// 红线：不要在调用方另抄一份存储逻辑。字段名映射、—— 出处拆分、#token 消歧、自动补标签
// 这些规则一旦有两份，改了一处另一处还在按旧规则写库，而且不会报错。

import { TITLE_PROMPT, CLASSIFY_PROMPT } from "../prompts.js";
import { chatJson } from "./llm.js";
import { insertRow, updateRow, getRow, setTags, tagsOf, linkTopicMaterials, findTopicByTitle } from "./db.js";
import { normMaterialType, INBOX_STATUS, VERIFICATION } from "./values.js";
import { isVaultEnabled, archiveMaterial, tryArchive } from "./vault.js";
import { extractTokens } from "../tasks/tweet.js";
import { assertGroundedGeneratedText, findSpecificPersonalClaims, verificationForMaterial } from "./integrity.js";

const SHORT_TEXT_LIMIT = 40;
const VIDEO_HOSTS = /(youtube\.com|youtu\.be|bilibili\.com|b23\.tv|douyin\.com|v\.qq\.com)/i;

// 命令名 → 素材类型（值的全集在 lib/values.js，那里是 schema.sql 的镜像）
export const STORE_TYPES = {
  金句: "金句/原话",
  概念: "核心观点",
  案例: "案例/故事",
  数据: "数据/事实",
  框架: "框架/模型",
  经历: "个人经历",
};
// Telegram 菜单命令必须是 ASCII，中文命令进不了菜单，故每个存素材命令配英文别名。
export const STORE_ALIASES = { quote: "金句", concept: "概念", case: "案例", data: "数据", framework: "框架", model: "框架", experience: "经历" };
const VERBATIM_CMDS = new Set(["金句", "数据"]); // 逐字保真类：原文照存，支持 —— 出处

export { normMaterialType };

// 把用户给的命令名（中文或英文别名）归一成中文命令名；不是存素材命令返回空串
export function resolveStoreCmd(cmd) {
  const c = String(cmd || "").toLowerCase();
  return STORE_TYPES[c] ? c : STORE_ALIASES[c] || "";
}

// 逐字保真类（金句/数据）支持 —— 出处，用法提示要据此变化
export function isVerbatimCmd(cmd) {
  return VERBATIM_CMDS.has(cmd);
}

// 逐字保真类的 —— 出处：仅取行尾最后一个 ——，前为正文、后为出处
function splitSource(text) {
  const idx = text.lastIndexOf("——");
  if (idx === -1) return { body: text.trim(), source: "" };
  return { body: text.slice(0, idx).trim(), source: text.slice(idx + 2).trim() };
}

// #token 消歧：先按名字匹配选题库，匹配到→关联选题；没匹配到→当标签。
// 让用户只管打 #，系统自己分是选题还是标签。
export async function resolveTokens(env, tokens) {
  const topicIds = [], topicTitles = [], tags = [];
  for (const t of tokens) {
    const topic = await findTopicByTitle(env, t);
    if (topic) {
      topicIds.push(topic.id);
      topicTitles.push(topic.title);
    } else {
      tags.push(t);
    }
  }
  return { topicIds, topicTitles, tags };
}

// 出处归一：URL 进 source_url 字段；非 URL（人名/书名/文件路径等）并回正文，保住溯源信息。
function applySource(body, source) {
  if (!source) return { body, sourceUrl: "" };
  if (/^https?:\/\//i.test(source)) return { body, sourceUrl: source };
  return { body: `${body}\n\n—— ${source}`, sourceUrl: "" };
}

/**
 * 直存指定类型素材（/金句 /概念 /案例 /数据 /框架 /经历，以及工作台按类型入库）。
 * @returns {{ok:false,reason:"empty"}|{ok:true,id,dbType,body,topicTitles,tags,needsAutoTag}}
 *   needsAutoTag=true 时调用方负责在回执之后调 autoTag（不阻塞用户）。
 */
export async function storeTypedMaterial(env, cmd, argStr, { source = "" } = {}) {
  const dbType = STORE_TYPES[cmd];
  if (!dbType) return { ok: false, reason: "empty" };
  const { tokens, rest } = extractTokens(String(argStr || ""));
  const { topicIds, topicTitles, tags } = await resolveTokens(env, tokens);

  let body = rest;
  let inlineSource = "";
  if (VERBATIM_CMDS.has(cmd)) ({ body, source: inlineSource } = splitSource(rest));
  if (!body.trim()) return { ok: false, reason: "empty" };

  // 命令里写的 —— 出处 优先；没写才用调用方带来的出处（工作台的书名 / 报告名 / 链接）
  const applied = applySource(body, inlineSource || source);
  body = applied.body;

  const verification = verificationForMaterial({
    type: dbType,
    note: body,
    sourceUrl: applied.sourceUrl,
    origin: "manual",
  });

  const id = await insertRow(env, "materials", {
    title: body.slice(0, 200),
    type: dbType,
    content: body,
    source_url: applied.sourceUrl,
    verification: verification.status,
    verification_note: verification.note,
  });
  if (tags.length) await setTags(env, "material", id, tags);
  for (const topicId of topicIds) await linkTopicMaterials(env, topicId, [id]);

  return { ok: true, id, dbType, body, topicTitles, tags, needsAutoTag: !tags.length };
}

/**
 * 随手粘：LLM 判类型 + 起标题 + 打标签（/素材，以及工作台不指定类型的入库）。
 * @returns {{ok:false,reason:"empty"}|{ok:true,id,dbType,title,body,topicTitles,tags,needsAutoTag:false}}
 */
export async function storeAutoMaterial(env, argStr, { source = "" } = {}) {
  const { tokens, rest } = extractTokens(String(argStr || ""));
  if (!rest.trim()) return { ok: false, reason: "empty" };
  const { topicIds, topicTitles, tags: manualTags } = await resolveTokens(env, tokens);

  const { json } = await chatJson(env, { system: CLASSIFY_PROMPT, user: rest.slice(0, 4000), maxTokens: 2000, task: "utility" });
  const dbType = normMaterialType(json.type);
  const title = (json.title || rest.slice(0, 30)).slice(0, 200);
  const titleEvidence = findSpecificPersonalClaims(rest).length
    ? [{ type: "个人经历", note: rest }]
    : [];
  assertGroundedGeneratedText(title, titleEvidence);
  const tags = manualTags.length ? manualTags : (Array.isArray(json.tags) ? json.tags.slice(0, 4) : []);

  const applied = applySource(rest, source);
  const verification = verificationForMaterial({
    type: dbType,
    note: applied.body,
    sourceUrl: applied.sourceUrl,
    origin: "manual",
  });

  const id = await insertRow(env, "materials", {
    title,
    type: dbType,
    content: applied.body,
    source_url: applied.sourceUrl,
    verification: verification.status,
    verification_note: verification.note,
  });
  if (tags.length) await setTags(env, "material", id, tags);
  for (const topicId of topicIds) await linkTopicMaterials(env, topicId, [id]);

  return { ok: true, id, dbType, title, body: applied.body, topicTitles, tags, needsAutoTag: false };
}

/**
 * 把一条已入库的素材归档进 vault。
 *
 * 和 `needsAutoTag` 同一个取舍：**由调用方决定何时做**。Telegram 要在回执之后补
 * （保住秒回），工作台用 `ctx.waitUntil`（不阻塞 HTTP 响应）。
 *
 * **必须排在 autoTag 之后**——标签要进 frontmatter，先归档的话 vault 里那份就没有
 * 标签了，而我们不回头改已写的文件。
 */
export async function archiveMaterialToVault(env, materialId) {
  if (!isVaultEnabled(env)) return null;
  const row = await getRow(env, "materials", materialId);
  if (!row) return null;
  const tags = (await tagsOf(env, "material", [materialId])).get(materialId) || [];
  const path = await tryArchive("material", () => archiveMaterial(env, row, { tags }));
  if (path) await updateRow(env, "materials", materialId, { vault_path: path });
  return path;
}

// 灵感库条目分类：含 URL→链接类（正文抓取留给任务1，入库保持轻快）；短文本→想法；长文本→LLM 提炼标题
export async function classifyInboxEntry(env, text) {
  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    const link = urlMatch[0];
    const note = text.replace(link, "").trim();
    return {
      type: VIDEO_HOSTS.test(link) ? "视频链接" : "文章链接",
      title: note || link,
      link,
      body: "",
    };
  }
  if (text.length <= SHORT_TEXT_LIMIT) {
    return { type: "想法", title: text, link: "", body: "" };
  }
  let title = text.slice(0, 30) + "…";
  try {
    const { json } = await chatJson(env, { system: TITLE_PROMPT, user: text.slice(0, 4000), maxTokens: 1000, task: "utility" });
    if (json.title) {
      const titleEvidence = findSpecificPersonalClaims(text).length
        ? [{ type: "个人经历", note: text }]
        : [];
      assertGroundedGeneratedText(json.title, titleEvidence);
      title = json.title;
    }
  } catch (e) {
    console.warn("title extraction failed, using truncated text:", e.message);
  }
  return { type: "摘录", title, link: "", body: text };
}

/**
 * 存进灵感库（状态=待初筛），走正常初筛流程。
 *
 * 正文原来要转成 Notion blocks 再随建页提交，现在直接进 `body` 列——它本来就是
 * 一段 Markdown，中间那趟块转换纯属被平台数据模型逼出来的。
 *
 * @param source 来源标记，Telegram 传 "Telegram"，工作台传 "工作台·热点" 这类
 */
export async function storeInboxEntry(env, text, { source = "Telegram" } = {}) {
  const entry = await classifyInboxEntry(env, text);
  const id = await insertRow(env, "inbox", {
    title: entry.title.slice(0, 200),
    kind: entry.type,
    link: entry.link,
    body: entry.body,
    source,
    status: INBOX_STATUS.PENDING,
  });
  return { ok: true, id, title: entry.title, type: entry.type, link: entry.link };
}
