// 任意网页的批注存进 vault：URL 决定稳定文件名，标题变化不会生成第二份文件。

import crypto from "node:crypto";
import { appendNote, listFiles, readFileOrEmpty, writeVaultFile } from "./vault.mjs";
import { applyNoteEdit, parseNotes } from "./notes.mjs";
import { DIRS } from "./vault-dirs.mjs";

const DIR = DIRS.webnote;
const TRACKING_KEYS = new Set(["fbclid", "gclid", "dclid", "msclkid", "spm", "ref_src"]);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function bad(message, status = 400, hint) {
  throw Object.assign(new Error(message), { status, hint });
}

export function normalizeWebUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) bad("缺少网页地址");
  if (raw.length > 4096) bad("网页地址过长");
  let url;
  try {
    url = new URL(raw);
  } catch {
    bad("网页地址无效");
  }
  if (!/^(https?):$/.test(url.protocol)) bad("只支持 http / https 网页");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString().slice(0, 2048);
}

export function safeWebSegment(input, fallback = "网页", max = 80) {
  let value = String(input || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, max)
    .trim();
  if (!value || WINDOWS_RESERVED.test(value)) value = fallback;
  return value;
}

export function webNoteId(url) {
  return crypto.createHash("sha256").update(normalizeWebUrl(url)).digest("hex").slice(0, 12);
}

async function locationOf(root, { url, title = "" }) {
  const normalizedUrl = normalizeWebUrl(url);
  const parsed = new URL(normalizedUrl);
  const host = safeWebSegment(parsed.hostname, "网页", 80);
  const id = webNoteId(normalizedUrl);
  const dir = `${DIR}/${host}`;
  const names = (await listFiles(root, dir, ".md")) || [];
  const existing = names.find((name) => name.startsWith(`${id}-`));
  const name = existing || `${id}-${safeWebSegment(title || parsed.hostname, "未命名网页", 72)}.md`;
  return { id, path: `${dir}/${name}`, normalizedUrl, host };
}

function cleanTitle(input) {
  return String(input || "未命名网页").replace(/[\r\n]+/g, " ").trim().slice(0, 300) || "未命名网页";
}

function cleanBody(input) {
  const body = String(input || "").trim();
  if (!body) bad("批注内容不能为空");
  if (body.length > 8000) bad("批注最多 8000 字");
  // notes.md 用二级时间标题切块；用户写二级标题时降一级，避免它被误认成另一条批注。
  return body.replace(/^##\s+/gm, "### ");
}

function documentHead(title, url) {
  return `# ${cleanTitle(title)}\n\n原文：[${url}](${url})\n`;
}

export async function readWebNotes(root, input) {
  const loc = await locationOf(root, input);
  const text = await readFileOrEmpty(root, loc.path);
  return { ...loc, title: cleanTitle(input.title), noteItems: parseNotes(text) };
}

export async function addWebNote(root, input) {
  const loc = await locationOf(root, input);
  const title = cleanTitle(input.title);
  const selection = String(input.selection || "").trim();
  if (!selection) bad("请先在网页上选中一段文字");
  if (selection.length > 4000) bad("选中文字最多 4000 字");
  const before = await readFileOrEmpty(root, loc.path);
  if (!before.trim()) await writeVaultFile(root, loc.path, documentHead(title, loc.normalizedUrl));
  await appendNote(root, loc.path, {
    quote: selection,
    quoteLimit: 4000,
    body: cleanBody(input.body),
    source: `[网页原文](${loc.normalizedUrl})`,
  });
  const text = await readFileOrEmpty(root, loc.path);
  return { ...loc, title, noteItems: parseNotes(text) };
}

export async function editWebNote(root, input) {
  const loc = await locationOf(root, input);
  if (!Number.isInteger(input.index)) bad("缺少批注编号");
  const before = await readFileOrEmpty(root, loc.path);
  if (!before) bad("找不到这份网页批注", 404);
  const after = applyNoteEdit(before, {
    index: input.index,
    body: input.remove ? "" : cleanBody(input.body),
    remove: !!input.remove,
    expect: String(input.stamp || ""),
  });
  await writeVaultFile(root, loc.path, after);
  return { ...loc, title: cleanTitle(input.title), noteItems: parseNotes(after) };
}
