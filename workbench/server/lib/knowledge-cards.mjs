import fs from "node:fs/promises";
import crypto from "node:crypto";
import { DIRS } from "./vault-dirs.mjs";
import { fileExists, parseFrontmatter, readFileOrEmpty, safeJoin, writeVaultFile } from "./vault.mjs";

const text = (value, max = 20_000) => String(value || "").trim().slice(0, max);
const yaml = (value) => JSON.stringify(String(value || "").replace(/[\r\n]+/g, " "));
const safeTitle = (value) => text(value, 80).replace(/[<>:"/\\|?*#^[\]]/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim() || "未命名知识卡";

function cardMarkdown(card, { id, createdAt }) {
  const tags = (Array.isArray(card.tags) ? card.tags : []).map((v) => text(v, 40)).filter(Boolean).slice(0, 12);
  const sourceTitle = text(card.sourceTitle, 300);
  const evidenceStatus = text(card.evidence) ? "有原文支撑" : "待验证";
  const processSource = sourceTitle || text(card.sourceUrl || card.sourceRef, 500) || "本次阅读对话";
  return [
    "---",
    `id: ${yaml(id)}`,
    `title: ${yaml(safeTitle(card.title))}`,
    `created_at: ${yaml(createdAt)}`,
    `source_kind: ${yaml(text(card.sourceKind, 40) || "conversation")}`,
    `source_ref: ${yaml(text(card.sourceRef, 500))}`,
    `source_url: ${yaml(text(card.sourceUrl, 2048))}`,
    `source_title: ${yaml(sourceTitle)}`,
    `evidence_status: ${yaml(evidenceStatus)}`,
    `tags: [${tags.map(yaml).join(", ")}]`,
    "---",
    "",
    `# ${safeTitle(card.title)}`,
    "",
    "## 一句话结论",
    "",
    text(card.conclusion) || "（待补）",
    "",
    "## 核心解释",
    "",
    text(card.explanation) || "（待补）",
    "",
    "## 原文证据",
    "",
    text(card.evidence) || "（暂无原文证据，待验证）",
    "",
    "## 适用边界",
    "",
    text(card.boundaries) || "（待补）",
    "",
    "## 反例或待验证问题",
    "",
    text(card.questions) || "（待补）",
    "",
    "## 我的理解",
    "",
    text(card.personalUnderstanding) || "（待补）",
    "",
    "## 形成过程",
    "",
    `- 来源：${processSource}`,
    `- AI 引擎：${text(card.engine, 120) || "未记录"}`,
    "",
  ].join("\n");
}

export async function saveKnowledgeCard(root, input = {}) {
  if (!text(input.title)) throw Object.assign(new Error("标题不能为空"), { status: 400 });
  const id = crypto.randomUUID();
  const shortId = id.replaceAll("-", "").slice(0, 8);
  const rel = `${DIRS.knowledge}/${safeTitle(input.title)}-${shortId}.md`;
  if (await fileExists(root, rel)) throw Object.assign(new Error("生成的卡片文件名已存在，请重试"), { status: 409 });
  const createdAt = new Date().toISOString();
  await writeVaultFile(root, rel, cardMarkdown(input, { id, createdAt }));
  return { id, path: rel, title: safeTitle(input.title), createdAt };
}

export async function knowledgeCardLinks(root, refs = []) {
  const wanted = new Set((Array.isArray(refs) ? refs : []).map(String).filter(Boolean).slice(0, 100));
  const counts = Object.fromEntries([...wanted].map((ref) => [ref, 0]));
  if (!wanted.size) return counts;
  let entries;
  try { entries = await fs.readdir(safeJoin(root, DIRS.knowledge), { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return counts; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const raw = await readFileOrEmpty(root, `${DIRS.knowledge}/${entry.name}`);
    const ref = String(parseFrontmatter(raw).meta.source_ref || "");
    if (wanted.has(ref)) counts[ref]++;
  }
  return counts;
}

export { safeTitle, cardMarkdown };
