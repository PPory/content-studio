import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { parseNotes } from "../lib/notes.mjs";
import { proxyFetch } from "../lib/fetch.mjs";
import { searchAll } from "../lib/search.mjs";
import { fetchBoards } from "../lib/sixty.mjs";
import { fetchAiHot } from "../lib/aihot.mjs";
import { agentAccess, agentPathStamp, resolveAgentMountPath } from "./agent-access.mjs";
import { listDir } from "../lib/vault.mjs";
import {
  assertModeTool,
  resolveProjectPath,
  resolveVaultPath,
} from "./permission-modes.mjs";

const text = (value, details = {}) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  details,
});
const clean = (value, max = 80_000) => String(value || "").trim().slice(0, max);

function assertNotAborted(signal) {
  if (signal?.aborted) throw signal.reason || Object.assign(new Error("操作已取消"), { name: "AbortError" });
}

function tool(name, label, description, parameters, execute) {
  return defineTool({
    name,
    label,
    description,
    parameters,
    async execute(_toolCallId, params, signal, onUpdate) {
      assertNotAborted(signal);
      return execute(params, signal, onUpdate);
    },
  });
}

async function appendAction(actionsFile, action) {
  if (!actionsFile) throw new Error("当前会话没有可用的动作队列");
  await fs.appendFile(actionsFile, `${JSON.stringify(action)}\n`, "utf8");
  return text("候选操作已提交给工作台，等待用户确认。不要声称已经写入或执行。", { actionType: action.type });
}

function compactSource(item) {
  return {
    id: clean(item.id, 160),
    type: clean(item.typeLabel || item.type || "本地资料", 80),
    title: clean(item.title || "未命名来源", 300),
    source: clean(item.source, 500),
    excerpt: clean(item.snippet || item.excerpt, 1_200),
    url: clean(item.url, 2_000),
    path: clean(item.path, 1_000),
  };
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff");
}

async function safeWebUrl(input) {
  let url;
  try { url = new URL(clean(input, 2_000)); } catch { throw Object.assign(new Error("网址格式不正确"), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error("只允许读取公开的 HTTP 或 HTTPS 网页"), { status: 400 });
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw Object.assign(new Error("不允许访问本机或局域网地址"), { status: 400 });
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length || records.some((item) => isPrivateIp(item.address))) throw Object.assign(new Error("不允许访问本机或局域网地址"), { status: 400 });
  return url;
}

function ensureMarkdownPath(value) {
  const relative = clean(value, 1_000).replaceAll("\\", "/");
  return relative.toLowerCase().endsWith(".md") ? relative : `${relative}.md`;
}

function validatePowerShell(command) {
  const value = clean(command, 8_000);
  if (!value) throw Object.assign(new Error("PowerShell 命令不能为空"), { status: 400 });
  if (/(?:\brm\b|remove-item|rd\s+\/s|rmdir\s+\/s|git\s+(?:reset\s+--hard|clean\s+-)|format-volume|clear-disk|remove-partition)/i.test(value)) {
    throw Object.assign(new Error("开发模式也不会代为执行破坏性删除或重置命令"), { status: 403 });
  }
  return value;
}

const SEARCH_SKIP = new Set([".git", "node_modules", ".xenho", "dist", "build", "coverage"]);

async function workspaceFiles(env, mountId, query, signal, maxResults = 12) {
  const access = await agentAccess(env);
  const mounts = mountId ? access.mounts.filter((item) => item.id === mountId) : access.mounts;
  if (!mounts.length) throw Object.assign(new Error("这个工作区尚未授权"), { status: 403 });
  const needle = clean(query, 300).toLowerCase();
  const matches = [];
  for (const mount of mounts) {
    if (mount.kind === "file") {
      const resolved = await resolveAgentMountPath(env, mount.id, ".");
      try {
        const stat = await fs.stat(resolved.absolute);
        if (stat.size <= 1_000_000) {
          const body = await fs.readFile(resolved.absolute, { encoding: "utf8", signal });
          if (!body.includes("\0")) {
            const index = body.toLowerCase().indexOf(needle);
            const nameHit = mount.onlyPath.toLowerCase().includes(needle);
            const excerpt = index >= 0 ? body.slice(Math.max(0, index - 180), index + needle.length + 420).replace(/\s+/g, " ") : "";
            if (nameHit || excerpt) matches.push({ mountId: mount.id, mount: mount.label, path: mount.onlyPath, excerpt: clean(excerpt, 800) });
          }
        }
      } catch {}
      continue;
    }
    const queue = ["."];
    let inspected = 0;
    while (queue.length && inspected < 1_200 && matches.length < maxResults) {
      assertNotAborted(signal);
      const relative = queue.shift();
      const resolved = await resolveAgentMountPath(env, mount.id, relative);
      let entries;
      try { entries = await fs.readdir(resolved.absolute, { withFileTypes: true }); }
      catch { continue; }
      for (const entry of entries) {
        if (SEARCH_SKIP.has(entry.name) || entry.name.startsWith(".git")) continue;
        const child = relative === "." ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) { queue.push(child); continue; }
        if (!entry.isFile()) continue;
        inspected += 1;
        const nameHit = child.toLowerCase().includes(needle);
        let excerpt = "";
        try {
          const stat = await fs.stat(path.join(resolved.absolute, entry.name));
          if (stat.size > 1_000_000) continue;
          const body = await fs.readFile(path.join(resolved.absolute, entry.name), { encoding: "utf8", signal });
          if (body.includes("\0")) continue;
          const index = body.toLowerCase().indexOf(needle);
          if (index >= 0) excerpt = body.slice(Math.max(0, index - 180), index + needle.length + 420).replace(/\s+/g, " ");
        } catch {}
        if (nameHit || excerpt) matches.push({ mountId: mount.id, mount: mount.label, path: child, excerpt: clean(excerpt, 800) });
        if (matches.length >= maxResults) break;
      }
    }
  }
  return matches;
}
export function createPiTools({ env, mode, context, actionsFile = "", reportFile = "", expertKind = "" }) {
  const allowed = (name) => assertModeTool(mode, name);
  const tools = [];

  tools.push(tool("propose_content_create", "准备新内容候选", "准备工作台新建内容候选。只生成待确认动作，不直接写入 Worker 或正文。", Type.Object({
    title: Type.String({ maxLength: 200 }),
    platform: Type.String({ maxLength: 40 }),
    audience: Type.Optional(Type.String({ maxLength: 500 })),
    viewpoint: Type.Optional(Type.String({ maxLength: 2_000 })),
    body: Type.String({ maxLength: 200_000 }),
  }), async ({ title, platform, audience = "", viewpoint = "", body }) => {
    allowed("propose_content_create");
    if (!clean(title, 200) || !clean(body, 200_000)) throw new Error("新建内容候选必须包含标题和正文");
    return appendAction(actionsFile, { type: "create_content", title: clean(title, 200), platform: clean(platform, 40), audience: clean(audience, 500), viewpoint: clean(viewpoint, 2_000), body: clean(body, 200_000) });
  }));

  tools.push(tool("project_read", "读取当前内容", "读取当前内容项目快照。只读。", Type.Object({}), async () => {
    allowed("project_read");
    return text(context.project || context.document || {});
  }));

  tools.push(tool("material_evidence", "读取项目素材", "读取项目明确关联的素材与来源字段。只读。", Type.Object({}), async () => {
    allowed("material_evidence");
    const materials = (context.projectMaterials || []).slice(0, 40).map((item) => ({
      id: clean(item.id, 160), title: clean(item.title || "未命名素材", 300),
      content: clean(item.content || item.note || item.summary, 2_000),
      source: clean(item.source || item.sourceUrl || item.url, 2_000),
      verification: clean(item.verification || item.verificationStatus, 100),
    }));
    return text({ total: materials.length, materials });
  }));

  tools.push(tool("publication_metrics", "读取发布数据", "读取当前项目记录的发布和复盘数据。只读，不推测缺失值。", Type.Object({}), async () => {
    allowed("publication_metrics");
    return text({ publication: context.project?.publication || null, review: context.project?.review || null });
  }));

  tools.push(tool("knowledge_search", "检索本地知识", "实时检索工作台知识索引和已授权工作区，不依赖预载快照。只读。", Type.Object({ query: Type.String({ maxLength: 300 }) }), async ({ query }, signal) => {
    allowed("knowledge_search");
    const needle = clean(query, 300);
    const indexed = await searchAll(env, needle, { limit: 12 }).catch(() => ({ results: [] }));
    const files = await workspaceFiles(env, "", needle, signal, 8).catch(() => []);
    const sources = [
      ...(indexed.results || []).map(compactSource),
      ...files.map((item) => compactSource({ id: `${item.mountId}:${item.path}`, type: "本地文件", title: path.basename(item.path), source: item.mount, snippet: item.excerpt, path: `${item.mountId}:${item.path}` })),
    ].slice(0, 16);
    return text({ query: needle, total: sources.length, sources });
  }));

  tools.push(tool("workspace_list", "查看已授权工作区", "列出 Agent 当前可访问的工作台与本轮对话明确指定的本地项目或文件。", Type.Object({
    mountId: Type.Optional(Type.String({ maxLength: 80 })),
    path: Type.Optional(Type.String({ maxLength: 1_000 })),
  }), async ({ mountId = "", path: requested = "." }) => {
    allowed("workspace_list");
    if (!mountId) {
      const access = await agentAccess(env);
      return text({ summary: access.summary, mounts: access.public });
    }
    const resolved = await resolveAgentMountPath(env, mountId, requested);
    const stat = await fs.stat(resolved.absolute);
    if (stat.isFile()) return text({ mountId, path: resolved.relative, items: [{ name: path.basename(resolved.absolute), type: "file" }] });
    const entries = await fs.readdir(resolved.absolute, { withFileTypes: true });
    return text({ mountId, path: resolved.relative, items: entries.filter((item) => !SEARCH_SKIP.has(item.name)).slice(0, 300).map((item) => ({ name: item.name, type: item.isDirectory() ? "directory" : item.isFile() ? "file" : "other" })) });
  }));

  tools.push(tool("workspace_search", "搜索已授权工作区", "按文件名和正文搜索工作台、Obsidian 或用户授权的本地项目。只读。", Type.Object({
    query: Type.String({ maxLength: 300 }),
    mountId: Type.Optional(Type.String({ maxLength: 80 })),
    maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
  }), async ({ query, mountId = "", maxResults = 12 }, signal) => {
    allowed("workspace_search");
    const results = await workspaceFiles(env, mountId, query, signal, maxResults);
    return text({ query: clean(query, 300), total: results.length, results });
  }));

  tools.push(tool("workspace_read", "读取已授权文件", "用工作区 ID 和相对路径读取本地文本文件。只读。", Type.Object({
    mountId: Type.String({ maxLength: 80 }),
    path: Type.String({ maxLength: 1_000 }),
  }), async ({ mountId, path: requested }, signal) => {
    allowed("workspace_read");
    const resolved = await resolveAgentMountPath(env, mountId, requested);
    const stat = await fs.stat(resolved.absolute);
    if (!stat.isFile() || stat.size > 5_000_000) throw Object.assign(new Error("只能读取不超过 5 MB 的文本文件"), { status: 400 });
    const content = await fs.readFile(resolved.absolute, { encoding: "utf8", signal });
    if (content.includes("\0")) throw Object.assign(new Error("这个文件不是可读取的文本"), { status: 400 });
    return text({ mountId, path: resolved.relative, stamp: String(Math.round(stat.mtimeMs)), content: content.slice(0, 160_000), truncated: content.length > 160_000 });
  }));

  tools.push(tool("hotspot_search", "读取工作台热点", "读取工作台已接入的平台热榜和 AI 情报源。只读。", Type.Object({
    query: Type.Optional(Type.String({ maxLength: 200 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
  }), async ({ query = "", limit = 15 }) => {
    allowed("hotspot_search");
    const [boards, ai] = await Promise.all([
      fetchBoards(env, { limit }).catch((error) => ({ error: error.message, boards: [] })),
      fetchAiHot({ limit: Math.max(limit, 20) }).catch((error) => ({ ok: false, error: error.message, items: [] })),
    ]);
    const needle = clean(query, 200).toLowerCase();
    const boardRows = Array.isArray(boards) ? boards : (boards.boards || []);
    const boardItems = boardRows.flatMap((board) => (board.items || []).map((item) => ({ source: board.label, title: item.title, url: item.url, rank: item.rank })));
    const aiItems = (ai.items || []).map((item) => ({ source: "AI 情报", title: item.title, summary: item.summary, url: item.url, at: item.at }));
    const items = [...boardItems, ...aiItems].filter((item) => !needle || JSON.stringify(item).toLowerCase().includes(needle)).slice(0, limit);
    return text({ query: clean(query, 200), total: items.length, items, warning: boards.error || ai.error || "" });
  }));

  tools.push(tool("attachment_read", "读取附件", "按当前对话附件 ID 读取已提取文本。只读。", Type.Object({ id: Type.String({ maxLength: 160 }) }), async ({ id }, signal) => {
    allowed("attachment_read");
    const item = (context.attachments || []).find((entry) => entry.id === clean(id, 160));
    if (!item) throw Object.assign(new Error("当前对话中没有这个附件"), { status: 404 });
    if (item.kind === "image") throw new Error("图片已直接作为视觉输入交给模型");
    const content = await fs.readFile(item.textPath, { encoding: "utf8", signal });
    return text({ id: item.id, name: item.name, text: content.slice(0, 120_000), truncated: content.length > 120_000 });
  }));

  tools.push(tool("skill_read", "读取技能说明", "读取本项目八个 Skill 的 SKILL.md 或其引用文件。只读。", Type.Object({ path: Type.String({ maxLength: 500 }) }), async ({ path: requested }, signal) => {
    allowed("skill_read");
    const resolved = await resolveProjectPath(`.agents/skills/${clean(requested, 500)}`, { allowSkills: true });
    if (!resolved.relative.startsWith(".agents/skills/")) throw Object.assign(new Error("只能读取项目 Skill 文件"), { status: 403 });
    const content = await fs.readFile(resolved.absolute, { encoding: "utf8", signal });
    return text(content.slice(0, 80_000), { path: resolved.relative, truncated: content.length > 80_000 });
  }));

  tools.push(tool("vault_list", "列出知识库目录", "列出知识库中的目录和 Markdown 文件。只读，路径必须是 vault 相对路径。", Type.Object({ path: Type.Optional(Type.String({ maxLength: 1_000 })) }), async ({ path: requested = "." }) => {
    allowed("vault_list");
    const resolved = await resolveVaultPath(env, requested || ".");
    return text({ path: resolved.relative, items: await listDir(resolved.root, resolved.relative) });
  }));

  tools.push(tool("vault_read", "读取知识库文档", "读取知识库中的 Markdown 文件。只读，路径必须是 vault 相对路径。", Type.Object({ path: Type.String({ maxLength: 1_000 }) }), async ({ path: requested }, signal) => {
    allowed("vault_read");
    const resolved = await resolveVaultPath(env, requested, { markdownOnly: true });
    const content = await fs.readFile(resolved.absolute, { encoding: "utf8", signal });
    const stamp = await fs.stat(resolved.absolute).then((item) => String(Math.round(item.mtimeMs)));
    return text({ path: resolved.relative, stamp, content: content.slice(0, 120_000), truncated: content.length > 120_000 }, { path: resolved.relative, stamp });
  }));

  tools.push(tool("annotation_list", "读取批注", "读取指定批注 Markdown 文件并返回结构化批注。只读。", Type.Object({ path: Type.String({ maxLength: 1_000 }) }), async ({ path: requested }, signal) => {
    allowed("annotation_list");
    const resolved = await resolveVaultPath(env, requested, { markdownOnly: true });
    const content = await fs.readFile(resolved.absolute, { encoding: "utf8", signal }).catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
    return text({ path: resolved.relative, annotations: parseNotes(content) });
  }));

  tools.push(tool("document_create", "准备新建文档", "在个人工作台目录准备新建 Markdown 文档候选，确认后才写入。", Type.Object({ path: Type.String({ maxLength: 1_000 }), content: Type.String({ maxLength: 200_000 }) }), async ({ path: requested, content }) => {
    allowed("document_create");
    const resolved = await resolveVaultPath(env, ensureMarkdownPath(requested), { write: true, markdownOnly: true });
    try { await fs.access(resolved.absolute); throw Object.assign(new Error("目标文档已经存在"), { status: 409 }); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return appendAction(actionsFile, { type: "document_create", path: resolved.relative, content: clean(content, 200_000), permissionMode: mode });
  }));

  tools.push(tool("document_update", "准备更新文档", "准备受控更新个人工作台中的 Markdown 文档。需要当前版本号并经用户确认。", Type.Object({ path: Type.String({ maxLength: 1_000 }), content: Type.String({ maxLength: 200_000 }), stamp: Type.String({ maxLength: 100 }) }), async ({ path: requested, content, stamp }) => {
    allowed("document_update");
    const resolved = await resolveVaultPath(env, ensureMarkdownPath(requested), { write: true, markdownOnly: true });
    return appendAction(actionsFile, { type: "document_update", path: resolved.relative, content: clean(content, 200_000), stamp: clean(stamp, 100), permissionMode: mode });
  }));

  tools.push(tool("annotation_append", "准备追加批注", "准备向个人工作台中的批注文件追加一条批注，确认后才写入。", Type.Object({ path: Type.String({ maxLength: 1_000 }), body: Type.String({ maxLength: 8_000 }), quote: Type.Optional(Type.String({ maxLength: 4_000 })), source: Type.Optional(Type.String({ maxLength: 2_000 })) }), async ({ path: requested, body, quote = "", source = "" }) => {
    allowed("annotation_append");
    const resolved = await resolveVaultPath(env, ensureMarkdownPath(requested), { write: true, markdownOnly: true });
    return appendAction(actionsFile, { type: "annotation_append", path: resolved.relative, body: clean(body, 8_000), quote: clean(quote, 4_000), source: clean(source, 2_000), permissionMode: mode });
  }));

  tools.push(tool("reference_insert", "准备插入引用", "准备把带来源的引用插入个人工作台 Markdown 文档，确认后才写入。", Type.Object({ path: Type.String({ maxLength: 1_000 }), text: Type.String({ maxLength: 20_000 }), source: Type.String({ maxLength: 2_000 }), stamp: Type.String({ maxLength: 100 }) }), async ({ path: requested, text: quoteText, source, stamp }) => {
    allowed("reference_insert");
    const resolved = await resolveVaultPath(env, ensureMarkdownPath(requested), { write: true, markdownOnly: true });
    return appendAction(actionsFile, { type: "reference_insert", path: resolved.relative, text: clean(quoteText, 20_000), source: clean(source, 2_000), stamp: clean(stamp, 100), permissionMode: mode });
  }));

  tools.push(tool("project_file_read", "读取项目文件", "开发模式下读取工作台项目内文件。只读。", Type.Object({ path: Type.String({ maxLength: 1_000 }) }), async ({ path: requested }, signal) => {
    allowed("project_file_read");
    const resolved = await resolveProjectPath(requested);
    const content = await fs.readFile(resolved.absolute, { encoding: "utf8", signal });
    const stamp = await fs.stat(resolved.absolute).then((item) => String(Math.round(item.mtimeMs)));
    return text({ path: resolved.relative, stamp, content: content.slice(0, 120_000), truncated: content.length > 120_000 }, { path: resolved.relative, stamp });
  }));

  tools.push(tool("write", "准备写入项目文件", "开发模式下准备写入项目文件，确认后才执行。", Type.Object({ path: Type.String({ maxLength: 1_000 }), content: Type.String({ maxLength: 200_000 }) }), async ({ path: requested, content }) => {
    allowed("write");
    const resolved = await resolveProjectPath(requested, { write: true });
    return appendAction(actionsFile, { type: "project_write", path: resolved.relative, content: clean(content, 200_000), permissionMode: mode });
  }));

  tools.push(tool("edit", "准备编辑项目文件", "开发模式下准备精确替换项目文件片段，确认后才执行。", Type.Object({ path: Type.String({ maxLength: 1_000 }), oldText: Type.String({ maxLength: 80_000 }), newText: Type.String({ maxLength: 80_000 }) }), async ({ path: requested, oldText, newText }) => {
    allowed("edit");
    const resolved = await resolveProjectPath(requested, { write: true });
    if (!oldText) throw new Error("精确编辑必须提供原片段");
    return appendAction(actionsFile, { type: "project_edit", path: resolved.relative, oldText: String(oldText).slice(0, 80_000), newText: String(newText).slice(0, 80_000), permissionMode: mode });
  }));

  tools.push(tool("powershell", "准备 PowerShell 命令", "开发模式下准备在工作台项目目录执行 PowerShell 命令，确认后才执行。", Type.Object({ command: Type.String({ maxLength: 8_000 }) }), async ({ command }) => {
    allowed("powershell");
    return appendAction(actionsFile, { type: "powershell", command: validatePowerShell(command), permissionMode: mode });
  }));

  tools.push(tool("workspace_write", "准备写入已授权文件", "开发模式下准备写入有写权限的本地工作区；确认后才执行。", Type.Object({
    mountId: Type.String({ maxLength: 80 }),
    path: Type.String({ maxLength: 1_000 }),
    content: Type.String({ maxLength: 200_000 }),
  }), async ({ mountId, path: requested, content }) => {
    allowed("workspace_write");
    const resolved = await resolveAgentMountPath(env, mountId, requested, { write: true });
    return appendAction(actionsFile, { type: "workspace_write", mountId: resolved.mount.id, path: resolved.relative, content: clean(content, 200_000), expectedStamp: await agentPathStamp(resolved.absolute), permissionMode: mode });
  }));

  tools.push(tool("workspace_edit", "准备编辑已授权文件", "开发模式下准备精确替换有写权限的本地文件；确认后才执行。", Type.Object({
    mountId: Type.String({ maxLength: 80 }),
    path: Type.String({ maxLength: 1_000 }),
    oldText: Type.String({ maxLength: 80_000 }),
    newText: Type.String({ maxLength: 80_000 }),
  }), async ({ mountId, path: requested, oldText, newText }) => {
    allowed("workspace_edit");
    if (!oldText) throw new Error("精确编辑必须提供原片段");
    const resolved = await resolveAgentMountPath(env, mountId, requested, { write: true });
    return appendAction(actionsFile, { type: "workspace_edit", mountId: resolved.mount.id, path: resolved.relative, oldText: String(oldText).slice(0, 80_000), newText: String(newText).slice(0, 80_000), expectedStamp: await agentPathStamp(resolved.absolute), permissionMode: mode });
  }));

  tools.push(tool("workspace_powershell", "准备在已授权工作区执行命令", "开发模式下准备在有执行权限的工作区运行 PowerShell；确认后才执行。", Type.Object({
    mountId: Type.String({ maxLength: 80 }),
    command: Type.String({ maxLength: 8_000 }),
  }), async ({ mountId, command }) => {
    allowed("workspace_powershell");
    const resolved = await resolveAgentMountPath(env, mountId, ".", { execute: true });
    return appendAction(actionsFile, { type: "workspace_powershell", mountId: resolved.mount.id, command: validatePowerShell(command), permissionMode: mode });
  }));
  tools.push(tool("web_search", "搜索公开网页", "通过工作台统一网络通道使用 Brave 搜索公开网页。只读。", Type.Object({ query: Type.String({ maxLength: 300 }), maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })) }), async ({ query, maxResults = 8 }, signal) => {
    allowed("web_search");
    const key = clean(env.BRAVE_SEARCH_API_KEY, 4_000);
    if (!key) throw Object.assign(new Error("联网搜索尚未配置"), { status: 400, hint: "在设置中填写 Brave Search 密钥。" });
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", clean(query, 300));
    url.searchParams.set("count", String(Math.max(1, Math.min(10, Number(maxResults) || 8))));
    url.searchParams.set("search_lang", "zh-hans");
    const response = await proxyFetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key }, signal });
    if (!response.ok) throw new Error(`Brave Search 返回 HTTP ${response.status}`);
    const data = await response.json();
    return text({ query: clean(query, 300), sources: (data.web?.results || []).map((item) => ({ url: clean(item.url, 2_000), title: clean(item.title, 500), snippet: clean(item.description, 1_200), publishedAt: clean(item.page_age || item.age, 100) })).filter((item) => item.url).slice(0, maxResults) });
  }));

  tools.push(tool("web_fetch", "读取公开网页", "读取一个公开 HTTP/HTTPS 网页，阻止本机和局域网地址。只读。", Type.Object({ url: Type.String({ maxLength: 2_000 }) }), async ({ url: inputUrl }, signal) => {
    allowed("web_fetch");
    const url = await safeWebUrl(inputUrl);
    const response = await proxyFetch(url, { headers: { Accept: "text/html, text/plain;q=0.9, application/json;q=0.8", "User-Agent": "Xenho-Content-Studio/1.0" }, redirect: "error", signal });
    if (!response.ok) throw new Error(`网页返回 HTTP ${response.status}`);
    const body = await response.text();
    return text({ url: url.href, contentType: clean(response.headers.get("content-type"), 200), content: body.slice(0, 120_000), truncated: body.length > 120_000 });
  }));

  tools.push(tool("submit_expert_report", "提交专家报告", "提交结构化专家报告。仅用于后台专家任务。", Type.Object({ reportJson: Type.String({ maxLength: 200_000 }) }), async ({ reportJson }) => {
    allowed("submit_expert_report");
    if (!reportFile) throw new Error("当前任务不是专家报告任务");
    let report;
    try { report = JSON.parse(reportJson); } catch { throw new Error("reportJson 不是合法 JSON"); }
    if (!report || typeof report !== "object" || Array.isArray(report) || (expertKind && report.kind !== expertKind)) throw new Error("报告结构与当前专家任务不一致");
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), "utf8");
    return text("结构化报告已提交。", { kind: report.kind });
  }));

  return tools;
}
