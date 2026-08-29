import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_OUTPUT = 4 * 1024 * 1024;
const TIMEOUT_MS = 180_000;
const IMAGE_BLOCK_PATTERN = /<image\b/i;
const PROTECTED_BLOCK_PATTERN = /<(?:file|whiteboard|bitable|sheet|add-ons|reference-synced|source-synced|task)\b/i;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

const textOf = (value) => String(value ?? "").replace(/\r\n/g, "\n");

export function documentFingerprint(title, markdown) {
  return crypto.createHash("sha256").update(`${textOf(title).trim()}\n\0${textOf(markdown)}`, "utf8").digest("hex");
}

export function formatFeishuDraftTitle(title, platform) {
  const cleanTitle = textOf(title).trim() || "未命名";
  const cleanPlatform = textOf(platform).trim();
  const prefix = cleanPlatform ? `[${cleanPlatform}] ` : "";
  return prefix && !cleanTitle.startsWith(prefix) ? `${prefix}${cleanTitle}` : cleanTitle;
}

export function localDraftTitle(remoteTitle, platform, currentTitle = "") {
  const cleanTitle = textOf(remoteTitle).trim() || "未命名";
  const cleanPlatform = textOf(platform).trim();
  const current = textOf(currentTitle).trim();
  if (current && cleanTitle === formatFeishuDraftTitle(current, cleanPlatform)) return current;
  if (!cleanPlatform) return cleanTitle;
  const prefix = `[${cleanPlatform}] `;
  return cleanTitle.startsWith(prefix) ? cleanTitle.slice(prefix.length).trim() || "未命名" : cleanTitle;
}

export function hasProtectedFeishuBlocks(markdown, { allowImages = false } = {}) {
  const value = textOf(markdown);
  return PROTECTED_BLOCK_PATTERN.test(value) || (!allowImages && IMAGE_BLOCK_PATTERN.test(value));
}

export function canRebuildFeishuImages(binding, localMarkdown) {
  return binding?.lastSource === "local" && !IMAGE_BLOCK_PATTERN.test(textOf(localMarkdown));
}

export function isDifferentFeishuTarget(binding, targetId) {
  return Boolean(binding && targetId && binding.containerId !== targetId);
}

export function markdownImageReferences(markdown) {
  return [...textOf(markdown).matchAll(MARKDOWN_IMAGE_PATTERN)].map((match) => ({
    alt: match[1],
    source: match[2],
    start: match.index,
    end: match.index + match[0].length,
    raw: match[0],
  }));
}

const escapeAttribute = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

export async function replaceMarkdownImages(markdown, resolveImage) {
  const value = textOf(markdown);
  const references = markdownImageReferences(value);
  if (!references.length) return { markdown: value, images: [] };
  const resolved = [];
  for (let index = 0; index < references.length; index += 1) {
    resolved.push(await resolveImage(references[index], index));
  }
  let cursor = 0;
  let output = "";
  references.forEach((reference, index) => {
    const item = resolved[index];
    output += value.slice(cursor, reference.start);
    output += `<image url="${escapeAttribute(item.url)}" alt="${escapeAttribute(reference.alt)}"/>`;
    cursor = reference.end;
  });
  output += value.slice(cursor);
  return { markdown: output, images: resolved };
}

export function feishuImageTokens(markdown) {
  return [...textOf(markdown).matchAll(/<image\b[^>]*\btoken="([^"]+)"[^>]*\/?\s*>/gi)].map((match) => match[1]);
}

export function decideDocumentSync(binding, localFingerprint, remoteFingerprint) {
  if (!binding) return { action: "create", localChanged: true, remoteChanged: false };
  const localChanged = localFingerprint !== binding.contentHash;
  const remoteChanged = remoteFingerprint !== binding.remoteHash;
  if (localChanged && remoteChanged) return { action: "conflict", localChanged, remoteChanged };
  if (remoteChanged) return { action: "pull-preview", localChanged, remoteChanged };
  if (localChanged) return { action: "push", localChanged, remoteChanged };
  return { action: "none", localChanged, remoteChanged };
}

export function parseLarkCliJson(stdout) {
  const text = String(stdout || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("飞书 CLI 没有返回 JSON");
  const result = JSON.parse(text.slice(start, end + 1));
  if (result.ok === false || result.error) {
    throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "飞书操作失败");
  }
  return result.data && typeof result.data === "object" ? result.data : result;
}

export function resolveLarkCliInvocation(args, {
  platform = process.platform,
  pathValue = process.env.PATH || "",
  nodePath = process.execPath,
  existsSync = fs.existsSync,
} = {}) {
  if (platform !== "win32") return { command: "lark-cli", args };
  const join = path.win32.join;
  for (const rawDir of String(pathValue).split(";")) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    const script = join(dir, "node_modules", "@larksuite", "cli", "scripts", "run.js");
    if (existsSync(script)) return { command: nodePath, args: [script, ...args] };
  }
  return { command: "lark-cli", args };
}

export function runLarkCli(args, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const invocation = resolveLarkCliInvocation(args);
    const child = spawn(invocation.command, invocation.args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const collect = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT) {
        child.kill();
        finish(new Error("飞书返回内容超过 4MB，暂不自动同步这篇文档"));
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    child.on("error", (error) => finish(new Error(error.code === "ENOENT" ? "找不到 lark-cli，请先安装并登录" : error.message)));
    child.on("close", (code) => {
      if (code !== 0) return finish(new Error(stderr.trim() || stdout.trim() || `飞书 CLI 退出码 ${code}`));
      try {
        finish(null, parseLarkCliJson(stdout));
      } catch (error) {
        finish(error);
      }
    });
    timer = setTimeout(() => {
      child.kill();
      finish(new Error(`飞书操作超过 ${Math.round(timeoutMs / 1000)} 秒，已停止`));
    }, timeoutMs);
  });
}

export async function fetchFeishuDocument(doc) {
  const data = await runLarkCli(["docs", "+fetch", "--as", "user", "--doc", String(doc), "--format", "json"]);
  return {
    id: data.doc_id || String(doc),
    title: String(data.title || ""),
    markdown: String(data.markdown || ""),
  };
}

export async function createFeishuDocument({ title, markdown, wikiNode, wikiSpace = "my_library" }) {
  const args = ["docs", "+create", "--as", "user", "--title", String(title || "未命名"), "--markdown", String(markdown || "")];
  if (wikiNode) args.push("--wiki-node", String(wikiNode));
  else args.push("--wiki-space", String(wikiSpace || "my_library"));
  const data = await runLarkCli(args);
  return {
    id: data.doc_id,
    url: data.doc_url || "",
  };
}

export async function overwriteFeishuDocument(doc, { title, markdown }) {
  return runLarkCli([
    "docs", "+update", "--as", "user", "--doc", String(doc), "--mode", "overwrite",
    "--new-title", String(title || "未命名"), "--markdown", String(markdown || ""),
  ]);
}
