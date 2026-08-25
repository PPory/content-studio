import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { parsePdf } from "../lib/books.mjs";
import { readBookMarks } from "../lib/marks.mjs";
import { searchAll } from "../lib/search.mjs";
import { WRITING_EXPERTS } from "../lib/writing-presets.mjs";
import { documentVersion } from "../../src/lib/document-version.js";
import { callWorker } from "../lib/worker.mjs";
import { createPiRun } from "./pi-runtime.mjs";
import { agentMountsFromUserMessage, agentPathStamp, resolveAgentMountPath } from "./agent-access.mjs";
import { DEFAULT_PERMISSION_MODE, normalizePermissionMode, permissionModeCatalog, assertConversationIdle, resolveProjectPath, resolveVaultPath } from "./permission-modes.mjs";
import { appendNote, fileStamp, listBooks, readFile as readVaultFile, vaultRoot, writeVaultFile } from "../lib/vault.mjs";
import { atomicWrite } from "../lib/safe-write.mjs";

const ROOT = path.resolve(process.cwd(), ".xenho", "assistant");
const execFileAsync = promisify(execFile);
const MODEL_CACHE_FILE = path.join(ROOT, "models.json");
const active = new Map();
const indexWrites = new Map();
const providerDispatcher = new EnvHttpProxyAgent();
const clean = (value, max = 80_000) => String(value || "").trim().slice(0, max);
const boundedText = (value, max = 200_000) => String(value ?? "").slice(0, max);
const now = () => new Date().toISOString();
const assistantModelUsable = (id) => !/(?:^|[-_.])(image|imagine|video|audio|tts|speech|whisper|transcri(?:be|ption)|embedding|rerank|moderation|realtime)(?:$|[-_.])/i.test(String(id || ""));
const scopeKey = (scopeId) => crypto.createHash("sha256").update(clean(scopeId, 240) || "global").digest("hex").slice(0, 24);
const scopeDir = (scopeId) => path.join(ROOT, scopeKey(scopeId));
const indexFile = (scopeId) => path.join(scopeDir(scopeId), "index.json");
const conversationDir = (scopeId, conversationId) => path.join(scopeDir(scopeId), "conversations", conversationId);
const conversationFile = (scopeId, conversationId) => path.join(conversationDir(scopeId, conversationId), "conversation.json");
const activeKey = (scopeId, conversationId) => `${clean(scopeId, 240)}:${conversationId}`;

async function queueIndexUpdate(scopeId, task) {
  const key = scopeKey(scopeId);
  const previous = indexWrites.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  indexWrites.set(key, next);
  try { return await next; }
  finally { if (indexWrites.get(key) === next) indexWrites.delete(key); }
}

function newConversationId() {
  return `chat-${crypto.randomUUID().replaceAll("-", "")}`;
}

function safeConversationId(value) {
  const id = clean(value, 80);
  return /^chat-[a-z0-9]+$/i.test(id) ? id : "";
}

function titleFrom(text) {
  const oneLine = clean(text, 120).replace(/\s+/g, " ");
  return oneLine.length > 28 ? `${oneLine.slice(0, 28)}…` : oneLine || "新对话";
}

function summaryOf(item) {
  return {
    id: item.id,
    title: item.title || "新对话",
    model: item.model || "",
    permissionMode: normalizePermissionMode(item.permissionMode),
    titleMode: item.titleMode === "manual" ? "manual" : "auto",
    pinnedAt: clean(item.pinnedAt, 80),
    archivedAt: clean(item.archivedAt, 80),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messageCount: Array.isArray(item.messages) ? item.messages.length : 0,
    preview: clean([...((item.messages || []))].reverse().find((message) => message.role === "user")?.text, 90),
    activeTurn: item.activeTurn ? {
      id: clean(item.activeTurn.id, 120),
      status: clean(item.activeTurn.status, 40),
      stage: clean(item.activeTurn.stage, 240),
      startedAt: item.activeTurn.startedAt,
      stageUpdatedAt: item.activeTurn.stageUpdatedAt,
    } : null,
  };
}

function sortConversationSummaries(items) {
  return [...items].sort((a, b) => {
    const pin = Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt));
    return pin || String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

async function readIndex(scopeId) {
  try {
    const data = JSON.parse(await fs.readFile(indexFile(scopeId), "utf8"));
    return {
      scopeId: clean(scopeId, 240),
      activeId: safeConversationId(data.activeId),
      items: Array.isArray(data.items) ? data.items.filter((item) => safeConversationId(item.id)) : [],
    };
  } catch {
    return { scopeId: clean(scopeId, 240), activeId: "", items: [] };
  }
}

async function writeIndex(scopeId, index) {
  const file = indexFile(scopeId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data = { scopeId: clean(scopeId, 240), activeId: index.activeId, items: index.items.slice(0, 100) };
  await atomicWrite(file, JSON.stringify(data, null, 2), { verify: (text) => JSON.parse(text) });
  return data;
}

async function readConversationRecord(scopeId, conversationId) {
  const id = safeConversationId(conversationId);
  if (!id) return null;
  try {
    const data = JSON.parse(await fs.readFile(conversationFile(scopeId, id), "utf8"));
    return {
      ...data,
      id,
      scopeId: clean(scopeId, 240),
      title: clean(data.title, 120) || "新对话",
      model: clean(data.model, 240),
      piSessionId: clean(data.piSessionId, 160),
      piSessionFile: clean(data.piSessionFile, 2_000),
      permissionMode: normalizePermissionMode(data.permissionMode),
      titleMode: data.titleMode === "manual" ? "manual" : "auto",
      pinnedAt: clean(data.pinnedAt, 80),
      archivedAt: clean(data.archivedAt, 80),
      pathGrants: Array.isArray(data.pathGrants) ? data.pathGrants.slice(-12) : [],
      createdAt: data.createdAt || now(),
      updatedAt: data.updatedAt || data.createdAt || now(),
      messages: Array.isArray(data.messages) ? data.messages.slice(-120) : [],
      attachments: Array.isArray(data.attachments) ? data.attachments.slice(-40) : [],
      actions: Array.isArray(data.actions) ? data.actions.slice(-40) : [],
      activeTurn: data.activeTurn && typeof data.activeTurn === "object" ? data.activeTurn : null,
      lastTurn: data.lastTurn && typeof data.lastTurn === "object" ? data.lastTurn : null,
      replayHistory: Boolean(data.replayHistory),
    };
  } catch {
    return null;
  }
}

async function writeConversationRecord(scopeId, record, options = {}) {
  const file = conversationFile(scopeId, record.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data = {
    ...record,
    id: record.id,
    scopeId: clean(scopeId, 240),
    title: clean(record.title, 120) || "新对话",
    model: clean(record.model, 240),
    piSessionId: clean(record.piSessionId, 160),
    piSessionFile: clean(record.piSessionFile, 2_000),
    permissionMode: normalizePermissionMode(record.permissionMode),
    titleMode: record.titleMode === "manual" ? "manual" : "auto",
    pinnedAt: clean(record.pinnedAt, 80),
    archivedAt: clean(record.archivedAt, 80),
    pathGrants: Array.isArray(record.pathGrants) ? record.pathGrants.slice(-12) : [],
    createdAt: record.createdAt || now(),
    updatedAt: options.touch === false ? (record.updatedAt || record.createdAt || now()) : now(),
    messages: (record.messages || []).slice(-120),
    attachments: (record.attachments || []).slice(-40),
    actions: (record.actions || []).slice(-40),
    activeTurn: record.activeTurn || null,
    lastTurn: record.lastTurn || null,
    replayHistory: Boolean(record.replayHistory),
  };
  await atomicWrite(file, JSON.stringify(data, null, 2), { verify: (text) => JSON.parse(text) });
  await queueIndexUpdate(scopeId, async () => {
    const index = await readIndex(scopeId);
    const summary = summaryOf(data);
    const items = sortConversationSummaries([summary, ...index.items.filter((item) => item.id !== record.id)]);
    await writeIndex(scopeId, { ...index, activeId: options.activate === false || data.archivedAt ? index.activeId : record.id, items });
  });
  return data;
}

export async function createAssistantConversation(scopeId, options = {}) {
  const id = newConversationId();
  return writeConversationRecord(scopeId, {
    id,
    title: "新对话",
    model: clean(options.model, 240),
    piSessionId: crypto.randomUUID(),
    piSessionFile: "",
    permissionMode: normalizePermissionMode(options.permissionMode),
    titleMode: "auto",
    pinnedAt: "",
    archivedAt: "",
    pathGrants: [],
    createdAt: now(),
    messages: [],
    attachments: [],
    actions: [],
    activeTurn: null,
    lastTurn: null,
    replayHistory: false,
  });
}

async function ensureConversation(scopeId, conversationId = "", options = {}) {
  const requested = safeConversationId(conversationId);
  if (requested) {
    const record = await readConversationRecord(scopeId, requested);
    if (record) return record;
  }
  const index = await readIndex(scopeId);
  if (!options.forceNew && index.activeId) {
    const record = await readConversationRecord(scopeId, index.activeId);
    if (record && !record.archivedAt) return record;
  }
  if (!options.forceNew) {
    try {
      const legacy = JSON.parse(await fs.readFile(path.join(scopeDir(scopeId), "conversation.json"), "utf8"));
      if (Array.isArray(legacy.messages) && legacy.messages.length) {
        const firstUser = legacy.messages.find((message) => message.role === "user")?.text;
        return writeConversationRecord(scopeId, {
          ...legacy,
          id: newConversationId(),
          title: titleFrom(firstUser || "历史对话"),
          model: clean(options.model, 240),
          createdAt: legacy.messages[0]?.createdAt || now(),
          piSessionId: crypto.randomUUID(),
          piSessionFile: "",
          permissionMode: DEFAULT_PERMISSION_MODE,
          messages: legacy.messages,
          attachments: [],
        });
      }
    } catch {}
  }
  return createAssistantConversation(scopeId, options);
}

async function recoverInterruptedConversation(scopeId, record) {
  if (!record?.activeTurn || active.has(activeKey(scopeId, record.id))) return record;
  record.lastTurn = { ...record.activeTurn, status: "interrupted", finishedAt: now(), error: "工作台重启前这轮对话没有正常结束" };
  record.activeTurn = null;
  return writeConversationRecord(scopeId, record);
}

export async function assistantConversations(scopeId) {
  const index = await readIndex(scopeId);
  return {
    ...index,
    items: (index.items || []).filter((item) => Number(item?.messageCount || 0) > 0 || clean(item?.preview, 2_000) || item?.titleMode === "manual"),
  };
}

export async function assistantConversation(scopeId, conversationId = "") {
  return recoverInterruptedConversation(scopeId, await ensureConversation(scopeId, conversationId));
}

export async function assistantModels(env, extraIds = [], options = {}) {
  const configured = clean(env.AGENT_LLM_MODEL, 240);
  const base = clean(env.AGENT_LLM_BASE_URL, 1_000).replace(/\/+$/, "");
  const key = clean(env.AGENT_LLM_API_KEY, 4_000);
  const remembered = [...new Set([configured, ...extraIds].map((item) => clean(item, 240)).filter(Boolean))];
  let cached = [];
  try {
    const data = JSON.parse(await fs.readFile(MODEL_CACHE_FILE, "utf8"));
    cached = Array.isArray(data.items) ? data.items.map((item) => ({ id: clean(item.id, 240), name: clean(item.name, 240) || clean(item.id, 240), ownedBy: clean(item.ownedBy, 120) })).filter((item) => item.id && assistantModelUsable(item.id)) : [];
  } catch {}
  const withRemembered = (items) => {
    const result = [...items];
    for (const id of remembered.toReversed()) if (assistantModelUsable(id) && !result.some((item) => item.id === id)) result.unshift({ id, name: id, remembered: true });
    return result;
  };
  if (options.refresh === false) {
    if (base && key) void assistantModels(env, extraIds).catch(() => {});
    return {
      items: withRemembered(cached),
      configured,
      source: cached.length ? "cache" : "settings",
      refreshing: Boolean(base && key),
      warning: !base || !key ? "模型目录未连接，显示的是本机上次成功获取的目录" : "",
    };
  }
  if (!base || !key) return { items: withRemembered(cached), configured, source: cached.length ? "cache" : "settings", warning: "模型目录未连接，显示的是本机上次成功获取的目录" };
  try {
    const root = base.replace(/\/chat\/completions$/i, "");
    const urls = [...new Set([`${root}/models`, ...(!/\/v1$/i.test(root) ? [`${root}/v1/models`] : [])])];
    const data = await Promise.any(urls.map(async (url) => {
      const response = await undiciFetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        dispatcher: providerDispatcher,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`${new URL(url).pathname} 返回 HTTP ${response.status}`);
      return response.json();
    }));
    const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    const items = [...new Map(rows.map((item) => {
      const id = clean(typeof item === "string" ? item : item?.id || item?.name, 240);
      return id ? [id, { id, name: clean(item?.name, 240) || id, ownedBy: clean(item?.owned_by || item?.provider, 120) }] : null;
    }).filter(Boolean)).values()].filter((item) => assistantModelUsable(item.id));
    const complete = withRemembered(items);
    await fs.mkdir(ROOT, { recursive: true });
    await fs.writeFile(MODEL_CACHE_FILE, JSON.stringify({ updatedAt: now(), items: complete }, null, 2), "utf8").catch(() => {});
    return { items: complete, configured, source: "provider" };
  } catch (error) {
    return { items: withRemembered(cached), configured, source: cached.length ? "cache" : "settings", warning: cached.length ? "模型服务本次没有返回目录，已显示上次成功获取的可用模型" : `模型目录暂时不可用：${error.message}` };
  }
}

export async function assistantModelCatalog(env) {
  const ids = [];
  try {
    const scopes = await fs.readdir(ROOT, { withFileTypes: true });
    for (const scope of scopes.filter((item) => item.isDirectory()).slice(0, 80)) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(ROOT, scope.name, "index.json"), "utf8"));
        for (const item of data.items || []) if (item.model) ids.push(item.model);
      } catch {}
    }
  } catch {}
  // 打开助手先把已配置模型和本机缓存交给前端；远端模型目录在后台刷新。
  // 否则 provider 慢十秒，输入框就会一直写着“选择模型”，看起来像不能开始对话。
  return assistantModels(env, ids, { refresh: false });
}

export async function assistantSkills() {
  let projectRoot = process.cwd();
  while (true) {
    try {
      await fs.stat(path.join(projectRoot, ".git"));
      break;
    } catch {
      const parent = path.dirname(projectRoot);
      if (parent === projectRoot) break;
      projectRoot = parent;
    }
  }
  const roots = [path.join(projectRoot, ".agents", "skills")];
  const items = [];
  const seen = new Set();
  for (const root of roots) {
    let entries = [];
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        const source = await fs.readFile(path.join(root, entry.name, "SKILL.md"), "utf8");
        const header = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
        const name = clean(header?.[1].match(/^name:\s*(.+)$/m)?.[1], 100) || entry.name;
        if (seen.has(name)) continue;
        seen.add(name);
        const description = clean(header?.[1].match(/^description:\s*(.+)$/m)?.[1], 500);
        items.push({ id: name, name, description, source: path.relative(projectRoot, root).replaceAll("\\", "/") });
      } catch {}
    }
  }
  return { items: items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) };
}

export function assistantExperts() {
  return {
    items: WRITING_EXPERTS.filter((item) => item.enabled).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      scene: item.scene,
      source: "xenho-preset",
    })),
  };
}

function expertForMessage(message) {
  const mention = String(message || "").match(/(?:^|\s)@([^\s@/]+)/u)?.[1] || "";
  return WRITING_EXPERTS.find((item) => item.enabled && (item.id === mention || item.name === mention)) || null;
}

export async function updateAssistantConversationModel(scopeId, conversationId, model) {
  const next = clean(model, 240);
  if (!next) throw Object.assign(new Error("请选择一个可用模型"), { status: 400 });
  const record = await ensureConversation(scopeId, conversationId);
  const key = activeKey(scopeId, record.id);
  if (active.has(key)) throw Object.assign(new Error("当前回复完成后才能切换模型"), { status: 409 });
  record.model = next;
  return writeConversationRecord(scopeId, record);
}

export function assistantSearchQueries(input) {
  const text = `${input.document?.title || ""}\n${input.message || ""}\n${input.document?.selection?.text || ""}`;
  const articleTitles = [...text.matchAll(/(?:有一篇|这篇|那篇|一篇)\s*[《“"]?(.{2,40}?)[》”"]?\s*(?:的)?(?:文章|稿件)/g)].map((match) => match[1].replace(/的$/u, "").trim());
  const bookTitles = [...text.matchAll(/(?:^|[\n，。！？])\s*[《“"]?([^\n，。！？《》“”"]{2,40}?)[》”"]?(?:里面|里)(?=[^\n，。！？]{0,8}(?:笔记|批注|高亮|标注|内容))/g)].map((match) => match[1].trim());
  const quoted = [...text.matchAll(/[“"《]([^”"》]{2,30})[”"》]/g)].map((match) => match[1]);
  const latin = text.match(/[A-Za-z][A-Za-z0-9._-]{2,36}/g) || [];
  const chinese = text.match(/[\u4e00-\u9fff]{2,12}/g) || [];
  return [...new Set([...articleTitles, ...bookTitles, ...quoted, ...latin, ...chinese, clean(input.document?.title, 36)])].filter((item) => item && item.length > 1).slice(0, 3);
}

export function assistantRetrievalRequested(input = {}) {
  const text = `${input.message || ""} ${input.document?.selection?.text || ""}`;
  if (/(搜索|搜一下|查一下|查找|检索|知识库|我的笔记|书里|找案例|找数据|找来源|出处|联网|事实核查|核实|查证)/i.test(text)) return true;
  if (input.mode !== "general") return false;
  const workspaceNoun = /(工作台|书架|收件箱|灵感库|素材库|选题库|稿件库|知识卡片|文章|稿件|书|笔记|批注|高亮|标注|阅读进度)/i.test(text);
  const lookupCue = /(有一篇|有没有|有没|是不是|是否|哪里|在哪|里面|读到|看到哪|进度|帮我看|找一下|打开)/i.test(text);
  return workspaceNoun && lookupCue;
}

async function matchingBookSources(env, input, queries) {
  const message = clean(input.message, 8_000);
  if (!queries.length || !/(书|书架|笔记|批注|高亮|标注|阅读进度|读到)/i.test(message)) return [];
  try {
    const root = vaultRoot(env);
    const books = await listBooks(root) || [];
    const needles = [...queries, message].map((item) => clean(item, 200).toLowerCase()).filter(Boolean);
    const matched = books.filter((book) => needles.some((needle) => needle.includes(book.name.toLowerCase()) || book.name.toLowerCase().includes(needle))).slice(0, 6);
    return Promise.all(matched.map(async (book) => {
      const marks = await readBookMarks(root, book.dir);
      return {
        id: `book:${book.dir}`,
        type: "book",
        typeLabel: "书架",
        title: book.name,
        source: [book.author, book.status].filter(Boolean).join(" · ") || "书架",
        state: book.status,
        snippet: `共 ${book.chapterCount || 1} 章；${marks.notes} 条批注，${marks.highlights} 条高亮；批注文件：${book.notePath}`,
        path: book.notePath,
      };
    }));
  } catch {
    return [];
  }
}
async function localContext(env, input, record) {
  const asksForSources = assistantRetrievalRequested(input);
  const queries = asksForSources ? assistantSearchQueries(input) : [];
  const sources = [];
  const seen = new Set();
  for (const item of await matchingBookSources(env, input, queries)) {
    seen.add(item.id);
    sources.push(item);
  }
  for (const query of queries) {
    const result = await searchAll(env, query, { limit: 8 });
    for (const item of result.results || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      sources.push({ ...item, matchedQuery: query });
      if (sources.length >= 28) break;
    }
    if (sources.length >= 28) break;
  }
  for (const [index, item] of (input.materials || []).slice(0, 16).entries()) {
    const id = `project-material:${item.id || index}`;
    if (seen.has(id)) continue;
    sources.unshift({ id, typeLabel: "项目素材", title: clean(item.title || "未命名素材", 200), snippet: clean(item.content || item.note || item.summary, 1_000), url: clean(item.sourceUrl || item.url, 1_000), source: "当前内容项目" });
  }
  return {
    queries,
    localSources: sources.slice(0, 40),
    retrievalMode: asksForSources ? "按需检索" : "未检索",
    attachments: (record.attachments || []).map(({ id, name, type, kind, bytes, characters, textPath }) => ({ id, name, type, kind, bytes, characters, textPath })),
    project: {
      title: clean(input.document?.title, 300),
      body: clean(input.document?.body, 60_000),
      platform: clean(input.document?.platform, 80),
      audience: clean(input.document?.audience, 300),
      selection: input.document?.selection || null,
      publication: input.document?.publication || null,
      review: input.document?.review || null,
    },
    projectMaterials: (input.materials || []).slice(0, 40),
  };
}

function retrievalPrompt(context) {
  if (context.retrievalMode === "未检索") return "【本轮工作台检索】未触发；不要据此断言工作台里没有内容。";
  const candidates = (context.localSources || []).slice(0, 12).map((item) => {
    const detail = [item.typeLabel || item.type, item.title, item.state, item.source, item.snippet, item.path].filter(Boolean).join(" · ");
    return `- ${detail}`;
  });
  return `【本轮工作台检索】查询：${(context.queries || []).join(" / ") || "无"}\n${candidates.length ? candidates.join("\n") : "没有命中。只能说本轮检索未命中，不能把它说成工作台没有内容。"}`;
}
function expertInstruction(input) {
  const expert = expertForMessage(input.message);
  return expert ? `【本轮调用专家：${expert.name}】\n${expert.instructions}` : "";
}

function runtimeModelInstruction(model) {
  return `【当前实际调用模型】${clean(model, 240) || "未配置"}。如果用户询问模型身份，只按这个模型 ID 回答；不要根据历史回复、自我训练来源或旧会话猜测品牌。`;
}

function contentPrompt(input, context, model) {
  const document = input.document || {};
  const selection = document.selection?.text ? `【当前选区】\n${clean(document.selection.text, 30_000)}` : "【当前选区】无；本轮默认围绕全文。";
  const body = clean(document.body, 60_000);
  const style = input.style?.instructions ? `【本篇调用风格：${clean(input.style.name || "未命名风格", 80)}】\n${clean(input.style.instructions, 8_000)}` : "【本篇调用风格】未指定；保持清楚、克制，不模仿不存在的个人口吻。";
  return [
    "你正在 Xenho OS 的内容项目中协助主创。先回答用户当前这一步，不抢走创作主导权。",
    "你可以分析、检索、提出建议或生成候选，但绝不能声称已经修改正文；正文只有用户点击采纳后才会变化。需要本地资料时调用 knowledge_search，需要时效性事实或公开证据时调用 web_search/web_fetch，读取附件时调用 attachment_read。用户明确要求在工作台另建内容时，调用 propose_content_create 提交待确认操作。",
    "来源不足就明确写不足，禁止编造个人经历、数字、引语和出处。如果用户要求改写，先说明你将给出候选，再给出可直接替换的文本。",
    runtimeModelInstruction(model),
    retrievalPrompt(context),
    `【当前内容】\n标题：${clean(document.title || "未命名", 300)}\n平台：${clean(document.platform, 50) || "未设置"}\n目标读者：${clean(document.audience, 200) || "沿用长期设置"}`,
    selection,
    body ? `【全文】\n${body}` : "【全文】尚未开始写。",
    style,
    expertInstruction(input),
    input.replayHistory ? `【为重新生成恢复的前文对话】\n${input.replayHistory}` : "",
    `【可读取附件】${context.attachments.map((item) => `${item.id}：${item.name}`).join("；") || "无"}`,
    `【用户本轮输入】\n${clean(input.message, 8_000)}`,
  ].join("\n\n");
}

function generalPrompt(input, context, model) {
  return [
    "你正在 Xenho OS 的独立 AI 助手中进行通用对话。这不是一篇待写文章，也没有默认写作任务。请直接理解并回答用户此刻的问题。",
    "你可以处理一般问答、分析、规划、研究、内容创作和文件阅读。需要用户本地知识时调用 knowledge_search；需要读取本地项目时先用 workspace_list 查看授权范围，再用 workspace_search/workspace_read；需要热点时调用 hotspot_search；需要新近公开信息时调用 web_search，并用 web_fetch 阅读关键来源；需要读取用户上传文件时调用 attachment_read。",
    "用户问工作台里是否有某篇文章、某本书、读到哪里、有没有笔记或批注时，必须以本轮工作台检索、vault_list、vault_read 或 annotation_list 的真实结果为准。当前内容项目为空不代表工作台为空，禁止因此回答没有检测到内容。",
    "不要因为工作台与内容创作有关，就把普通问候解释为确定选题、搭结构或开始写稿。只有用户明确提出写作任务时才进入创作流程。不要声称执行了未实际调用的工具或修改。",
    "当用户明确要求在工作台里新建内容并给出正文时，必须调用 propose_content_create 提交结构化候选；不要只把正文回复在聊天里。该工具只生成待确认操作，用户确认后工作台才会真正写入。",
    runtimeModelInstruction(model),
    retrievalPrompt(context),
    expertInstruction(input),
    input.replayHistory ? `【为重新生成恢复的前文对话】\n${input.replayHistory}` : "",
    `【可读取附件】${context.attachments.map((item) => `${item.id}：${item.name}（${item.characters || 0} 字符）`).join("；") || "无"}`,
    `【用户本轮输入】\n${clean(input.message, 8_000)}`,
  ].join("\n\n");
}

const TOOL_LABELS = {
  knowledge_search: "正在检索本地知识库",
  project_read: "正在读取当前内容项目",
  material_evidence: "正在核对项目素材与证据",
  publication_metrics: "正在读取发布与复盘数据",
  attachment_read: "正在读取附件",
  web_search: "正在搜索公开网页",
  web_fetch: "正在阅读网页来源",
  skill: "正在加载 Skill",
  submit_expert_report: "正在整理专家结论",
  propose_content_create: "正在准备工作台新建内容候选",
};

function normalizeProposedAction(item, permissionMode) {
  if (!item || typeof item !== "object") return null;
  const base = {
    id: `action-${crypto.randomUUID().replaceAll("-", "")}`,
    type: clean(item.type, 80),
    status: "pending",
    permissionMode: normalizePermissionMode(item.permissionMode || permissionMode),
    createdAt: now(),
  };
  if (item.type === "create_content") return {
    ...base,
    title: clean(item.title, 200) || "未命名",
    platform: ["公众号", "X", "小红书", "视频号", "YouTube"].includes(item.platform) ? item.platform : "公众号",
    audience: clean(item.audience, 500), viewpoint: clean(item.viewpoint, 2_000), body: clean(item.body, 200_000),
  };
  if (["document_create", "document_update", "annotation_append", "reference_insert", "workspace_write", "workspace_edit", "workspace_powershell", "project_write", "project_edit", "powershell"].includes(item.type)) {
    return { ...base, ...item, id: base.id, status: base.status, createdAt: base.createdAt, permissionMode: base.permissionMode };
  }
  return null;
}

export function assistantPermissionModes() {
  return { items: permissionModeCatalog(), defaultMode: DEFAULT_PERMISSION_MODE };
}

export async function manageAssistantConversation(scopeId, conversationId, input = {}) {
  const id = safeConversationId(conversationId);
  const action = clean(input.action, 40);
  if (!id || !["rename", "pin", "unpin", "archive", "restore", "delete"].includes(action)) {
    throw Object.assign(new Error("未知的对话管理操作"), { status: 400 });
  }
  const record = await readConversationRecord(scopeId, id);
  if (!record) throw Object.assign(new Error("对话不存在"), { status: 404 });
  assertConversationIdle(active, activeKey(scopeId, id));

  if (action === "delete") {
    const source = conversationDir(scopeId, id);
    const trash = path.join(scopeDir(scopeId), ".trash");
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(source, path.join(trash, `${id}-${Date.now()}`));
    await queueIndexUpdate(scopeId, async () => {
      const index = await readIndex(scopeId);
      const items = index.items.filter((item) => item.id !== id);
      const activeId = index.activeId === id ? (items.find((item) => !item.archivedAt)?.id || "") : index.activeId;
      await writeIndex(scopeId, { ...index, activeId, items });
    });
    return { deletedId: id, conversations: await assistantConversations(scopeId) };
  }

  if (action === "rename") {
    const title = clean(input.title, 120);
    if (!title) throw Object.assign(new Error("对话名称不能为空"), { status: 400 });
    record.title = title;
    record.titleMode = "manual";
  } else if (action === "pin") {
    record.pinnedAt = now();
    record.archivedAt = "";
  } else if (action === "unpin") {
    record.pinnedAt = "";
  } else if (action === "archive") {
    record.archivedAt = now();
    record.pinnedAt = "";
  } else if (action === "restore") {
    record.archivedAt = "";
  }

  const saved = await writeConversationRecord(scopeId, record, { activate: false, touch: false });
  if (action === "archive") {
    await queueIndexUpdate(scopeId, async () => {
      const index = await readIndex(scopeId);
      if (index.activeId !== id) return;
      const activeId = index.items.find((item) => item.id !== id && !item.archivedAt)?.id || "";
      await writeIndex(scopeId, { ...index, activeId });
    });
  }
  return { conversation: saved, conversations: await assistantConversations(scopeId) };
}

export async function updateAssistantPermissionMode(scopeId, conversationId, permissionMode) {
  const record = await ensureConversation(scopeId, conversationId);
  const key = activeKey(scopeId, record.id);
  assertConversationIdle(active, key);
  const requested = String(permissionMode || "").trim();
  if (!permissionModeCatalog().some((item) => item.id === requested)) throw Object.assign(new Error("未知的权限模式"), { status: 400 });
  record.permissionMode = requested;
  record.piSessionId = crypto.randomUUID();
  record.piSessionFile = "";
  record.replayHistory = true;
  record.actions = (record.actions || []).map((item) => item.status === "pending" ? { ...item, status: "superseded" } : item);
  return writeConversationRecord(scopeId, record);
}

export async function runAssistantTurn(env, input = {}, options = {}) {
  const startedAt = Date.now();
  const scopeId = clean(input.scopeId, 240);
  const message = clean(input.message, 8_000);
  if (!scopeId) throw Object.assign(new Error("缺少当前对话范围"), { status: 400 });
  if (!message) throw Object.assign(new Error("先写下想让 AI 帮你做什么"), { status: 400 });
  const record = await ensureConversation(scopeId, input.conversationId, { model: input.model || env.AGENT_LLM_MODEL, permissionMode: input.permissionMode, forceNew: Boolean(input.startNew && !input.conversationId) });
  let runtimeEnv = env;
  const key = activeKey(scopeId, record.id);
  if (active.has(key)) throw Object.assign(new Error("AI 助手还在处理上一条消息"), { status: 409 });
  let stageWrite = Promise.resolve();
  const runState = { session: null, cancelled: false, drain: () => stageWrite };
  active.set(key, runState);
  options.onEvent?.({ type: "conversation", conversationId: record.id });

  const dir = conversationDir(scopeId, record.id);
  await fs.mkdir(dir, { recursive: true });
  const turnId = `turn-${crypto.randomUUID().replaceAll("-", "")}`;
  const actionsFile = path.join(dir, "actions.jsonl");
  let lastStageWriteAt = 0;
  const emit = (event) => {
    options.onEvent?.(event);
    if (event?.type !== "status" || !event.stage) return;
    const timestamp = Date.now();
    if (timestamp - lastStageWriteAt < 1_200) return;
    lastStageWriteAt = timestamp;
    stageWrite = stageWrite.then(async () => {
      const latest = await readConversationRecord(scopeId, record.id).catch(() => null);
      if (!latest?.activeTurn || latest.activeTurn.id !== turnId) return;
      latest.activeTurn = { ...latest.activeTurn, stage: clean(event.stage, 240), stageUpdatedAt: now() };
      await writeConversationRecord(scopeId, latest);
    }).catch(() => {});
  };
  let context;
  try {
    const userMessage = { id: `user-${Date.now().toString(36)}`, role: "user", text: message, createdAt: now() };
    const grants = await agentMountsFromUserMessage(message);
    record.pathGrants = [...(record.pathGrants || []), ...grants].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).slice(-12);
    record.archivedAt = "";
    record.model = clean(input.model, 240) || record.model || clean(env.AGENT_LLM_MODEL, 240);
    record.title = record.messages.length || record.titleMode === "manual" ? record.title : titleFrom(message);
    record.messages = [...record.messages, userMessage];
    runtimeEnv = { ...env, AGENT_SESSION_MOUNTS: record.pathGrants, AGENT_PERMISSION_MODE: record.permissionMode };
    record.activeTurn = { id: turnId, status: "running", startedAt: now(), stage: "正在读取上下文", stageUpdatedAt: now() };
    await writeConversationRecord(scopeId, record);
    emit({ type: "status", stage: "正在读取上下文" });
    context = await localContext(runtimeEnv, input, record);
    await fs.writeFile(path.join(dir, "context.json"), JSON.stringify({ document: input.document || {}, ...context }, null, 2), "utf8");
    emit({ type: "status", stage: "上下文已就绪，正在启动 Pi" });
  } catch (error) {
    active.delete(key);
    throw error;
  }

  let piSession;
  try {
    const standalone = input.mode === "general";
    await fs.rm(actionsFile, { force: true }).catch(() => {});
    const replayHistory = record.replayHistory ? record.messages.slice(0, -1).slice(-20).map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${clean(item.text, 6_000)}`).join("\n\n") : "";
    const turnInput = replayHistory ? { ...input, replayHistory } : input;
    const prompt = standalone ? generalPrompt(turnInput, context, record.model) : contentPrompt(turnInput, context, record.model);
    const pendingImages = (record.attachments || []).filter((item) => item.kind === "image" && !item.usedAt);
    emit({ type: "status", stage: "已交给 Pi 模型，正在等待首个响应" });
    const timeoutMs = Math.max(60_000, Math.min(15 * 60_000, Number(env.AGENT_ASSISTANT_TIMEOUT_MS) || 5 * 60_000));
    let timeout;
    if (runState.cancelled) throw Object.assign(new Error("本轮已停止"), { code: "ASSISTANT_CANCELLED" });
    const runPromise = createPiRun({
      env: runtimeEnv,
      runDir: dir,
      kind: "assistant-chat",
      prompt,
      persona: standalone
        ? `你是 Xenho OS 的通用 AI 助手。当前实际调用模型 ID 是 ${record.model}。直接回应用户真实意图，可调用知识库、公开网页、附件和 Skill；不预设用户正在写文章，不伪造事实、来源、文件内容或已执行动作。`
        : `你是 Xenho OS 的内容项目助手。当前实际调用模型 ID 是 ${record.model}。协助主创分析、检索和生成候选；不得静默改正文，不得伪造事实、来源或用户经历。`,
      sessionRoot: path.join(dir, "pi-sessions"),
      sessionId: record.piSessionId,
      sessionFile: record.piSessionFile,
      model: record.model,
      mode: record.permissionMode,
      context,
      actionsFile,
      images: pendingImages.map((item) => ({ path: item.originalPath, mediaType: item.imageRef?.mediaType || item.type })),
      onEvent: emit,
      onSession(instance, meta) {
        piSession = instance;
        record.piSessionId = meta.sessionId;
        record.piSessionFile = meta.sessionFile;
        runState.session = instance;
        active.set(key, runState);
      },
    });
    const result = await Promise.race([
      runPromise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          piSession?.abort().catch(() => {});
          reject(Object.assign(new Error(`模型在 ${Math.round(timeoutMs / 60_000)} 分钟内没有完成这轮任务`), {
            hint: "已自动停止本轮，可换用更快的模型，或将长任务拆成几步。",
          }));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]).finally(() => clearTimeout(timeout));
    const text = clean(result.result.finalResponse, 40_000);
    if (!text) throw new Error("Pi 已结束，但没有返回可显示的内容");
    const latest = await readConversationRecord(scopeId, record.id) || record;
    let proposed = [];
    try {
      const lines = (await fs.readFile(actionsFile, "utf8")).split(/\r?\n/).filter(Boolean);
      proposed = lines.map((line) => normalizeProposedAction(JSON.parse(line), record.permissionMode)).filter(Boolean).slice(0, 8);
    } catch {}
    const assistantMessage = { id: `assistant-${Date.now().toString(36)}`, role: "assistant", text, createdAt: now(), engine: "Pi Agent SDK", model: record.model, durationMs: Date.now() - startedAt, retrievalMode: context.retrievalMode, documentVersion: clean(input.documentVersion, 120) || documentVersion(input.document), actionIds: proposed.map((item) => item.id) };
    latest.messages = [...latest.messages, assistantMessage];
    latest.actions = [...(latest.actions || []), ...proposed];
    latest.attachments = (latest.attachments || []).map((item) => pendingImages.some((image) => image.id === item.id) ? { ...item, usedAt: now() } : item);
    latest.model = record.model;
    latest.piSessionId = result.piSessionId;
    latest.piSessionFile = result.piSessionFile;
    latest.permissionMode = result.permissionMode;
    latest.lastTurn = { id: turnId, status: "done", startedAt: record.activeTurn?.startedAt, finishedAt: now(), durationMs: assistantMessage.durationMs };
    latest.activeTurn = null;
    latest.replayHistory = false;
    const saved = await writeConversationRecord(scopeId, latest);
    await stageWrite;
    options.onEvent?.({ type: "complete", turnId, durationMs: assistantMessage.durationMs });
    return { conversation: saved, message: assistantMessage };
  } catch (error) {
    const latest = await readConversationRecord(scopeId, record.id).catch(() => null);
    const cancelled = latest?.lastTurn?.id === turnId && latest.lastTurn.status === "cancelled";
    if (latest && !cancelled) {
      latest.lastTurn = { id: turnId, status: "failed", startedAt: latest.activeTurn?.startedAt, finishedAt: now(), error: clean(error.message, 1_000) };
      latest.activeTurn = null;
      await writeConversationRecord(scopeId, latest).catch(() => {});
    }
    if (cancelled) return { conversation: latest, message: null, cancelled: true };
    throw error;
  } finally {
    active.delete(key);
    piSession?.dispose();
  }
}

function safeUploadName(value) {
  return path.basename(clean(value, 180)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() || "附件.txt";
}

async function extractAttachment(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") return (await parsePdf(bytes)).text;
  const allowed = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".html", ".htm", ".yaml", ".yml", ".js", ".jsx", ".ts", ".tsx", ".css"]);
  if (!allowed.has(ext)) throw Object.assign(new Error("目前可直接读取 PDF、Markdown、TXT、CSV、JSON、HTML、YAML 和常见代码文件"), { status: 400 });
  const text = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) throw Object.assign(new Error("这个文件不是可读取的文本文件"), { status: 400 });
  return text;
}

function imageInfo(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  const mediaType = types[ext];
  if (!mediaType) return null;
  const b = Buffer.from(bytes);
  let width = 0; let height = 0;
  if (mediaType === "image/png" && b.length >= 24 && b.subarray(1, 4).toString() === "PNG") { width = b.readUInt32BE(16); height = b.readUInt32BE(20); }
  else if (mediaType === "image/gif" && b.length >= 10 && b.subarray(0, 3).toString() === "GIF") { width = b.readUInt16LE(6); height = b.readUInt16LE(8); }
  else if (mediaType === "image/webp" && b.length >= 30 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") {
    const kind = b.subarray(12, 16).toString();
    if (kind === "VP8X") { width = 1 + b.readUIntLE(24, 3); height = 1 + b.readUIntLE(27, 3); }
    else if (kind === "VP8 " && b.length >= 30) { width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff; }
    else if (kind === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    }
  } else if (mediaType === "image/jpeg" && b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let offset = 2; offset + 9 < b.length;) {
      if (b[offset] !== 0xff) { offset += 1; continue; }
      const marker = b[offset + 1]; const size = b.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { height = b.readUInt16BE(offset + 5); width = b.readUInt16BE(offset + 7); break; }
      offset += Math.max(2, size + 2);
    }
  }
  if (!width || !height) throw Object.assign(new Error("这张图片无法识别，请换成 PNG、JPG、WebP 或 GIF"), { status: 400 });
  if (bytes.length > 15_000_000 || width * height > 25_165_824) throw Object.assign(new Error("这张图超出当前模型可靠读取的范围"), { status: 400, hint: "工作台会自动压缩大图；如果仍然失败，请换用 1500 万字节、2500 万像素以内的图片。" });
  return { mediaType, width, height };
}

export async function saveAssistantAttachment(scopeId, conversationId, fileName, bytes) {
  const record = await ensureConversation(scopeId, conversationId, { forceNew: !conversationId });
  if (!bytes?.length) throw Object.assign(new Error("没有收到文件内容"), { status: 400 });
  const name = safeUploadName(fileName);
  const image = imageInfo(name, bytes);
  const text = image ? "" : await extractAttachment(name, bytes);
  const id = `file-${crypto.randomUUID().replaceAll("-", "")}`;
  const dir = path.join(conversationDir(scopeId, record.id), "attachments", id);
  await fs.mkdir(dir, { recursive: true });
  const originalPath = path.join(dir, name);
  const textPath = path.join(dir, "content.txt");
  await fs.writeFile(originalPath, bytes);
  if (!image) await fs.writeFile(textPath, text.slice(0, 1_000_000), "utf8");
  const attachmentId = image ? `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` : "";
  const imageRef = image ? { attachmentId, mediaType: image.mediaType, bytes: bytes.length, width: image.width, height: image.height, name } : null;
  const item = { id, name, type: image?.mediaType || path.extname(name).slice(1) || "text", kind: image ? "image" : "text", bytes: bytes.length, characters: Math.min(text.length, 1_000_000), originalPath, ...(!image ? { textPath } : {}), ...(image ? { imageRef } : {}), createdAt: now() };
  record.attachments = [...record.attachments, item];
  if (image) {
    const images = Object.fromEntries(record.attachments.filter((entry) => entry.kind === "image").map((entry) => [entry.imageRef.attachmentId, { ...entry.imageRef, path: entry.originalPath }]));
    await fs.writeFile(path.join(conversationDir(scopeId, record.id), "images.json"), JSON.stringify(images, null, 2), "utf8");
  }
  const saved = await writeConversationRecord(scopeId, record);
  return { conversationId: saved.id, attachment: { id, name, type: item.type, kind: item.kind, bytes: item.bytes, characters: item.characters, createdAt: item.createdAt } };
}

export async function rewindAssistantConversation(scopeId, conversationId) {
  const record = await ensureConversation(scopeId, conversationId);
  const key = activeKey(scopeId, record.id);
  if (active.has(key)) throw Object.assign(new Error("当前回复完成后才能重新生成"), { status: 409 });
  let userIndex = -1;
  for (let index = record.messages.length - 1; index >= 0; index -= 1) if (record.messages[index].role === "user") { userIndex = index; break; }
  if (userIndex < 0) throw Object.assign(new Error("这轮对话还没有可重新发送的问题"), { status: 400 });
  const message = record.messages[userIndex].text;
  record.messages = record.messages.slice(0, userIndex);
  record.actions = (record.actions || []).map((item) => item.status === "pending" ? { ...item, status: "superseded" } : item);
  record.piSessionId = crypto.randomUUID();
  record.piSessionFile = "";
  record.replayHistory = true;
  record.activeTurn = null;
  const saved = await writeConversationRecord(scopeId, record);
  return { conversation: saved, message };
}

export async function applyAssistantAction(env, scopeId, conversationId, actionId) {
  const record = await ensureConversation(scopeId, conversationId);
  const runtimeEnv = { ...env, AGENT_SESSION_MOUNTS: record.pathGrants || [], AGENT_PERMISSION_MODE: record.permissionMode };
  const action = (record.actions || []).find((item) => item.id === clean(actionId, 100));
  if (!action) throw Object.assign(new Error("没有找到这项待执行操作"), { status: 404 });
  if (action.status === "applied") return { conversation: record, action, result: action.result };
  if (action.status !== "pending") throw Object.assign(new Error("这项操作已经失效"), { status: 409 });
  let result;
  if (action.type === "create_content") {
    const response = await callWorker(env, "create", { method: "POST", body: { kind: "draft", mode: "blank", title: action.title, platform: action.platform, audience: action.audience, viewpoint: action.viewpoint, body: action.body, materialIds: [] } });
    if (response.status >= 400 || response.data?.ok === false) throw Object.assign(new Error(response.data?.error || "工作台没有完成新建内容"), { status: response.status || 500, hint: response.data?.hint });
    result = { projectId: response.data?.project?.id || response.data?.topic?.id || "", title: response.data?.topic?.title || action.title };
  } else if (["document_create", "document_update", "annotation_append", "reference_insert"].includes(action.type)) {
    if (!['creative', 'developer'].includes(action.permissionMode) || !['creative', 'developer'].includes(record.permissionMode)) throw Object.assign(new Error("这项写入没有创作权限"), { status: 403 });
    const resolved = await resolveVaultPath(env, action.path, { write: true, markdownOnly: true });
    if (action.type === "document_create") {
      try { await fs.access(resolved.absolute); throw Object.assign(new Error("目标文档已经存在"), { status: 409 }); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      await writeVaultFile(resolved.root, resolved.relative, boundedText(action.content, 200_000));
    } else if (action.type === "annotation_append") {
      await appendNote(resolved.root, resolved.relative, { body: clean(action.body, 8_000), quote: clean(action.quote, 4_000), source: clean(action.source, 2_000), quoteLimit: 4_000 });
    } else {
      const currentStamp = await fileStamp(resolved.root, resolved.relative);
      if (!action.stamp || action.stamp !== currentStamp) throw Object.assign(new Error("文档已在别处变化，拒绝覆盖"), { status: 409, hint: "重新读取文档后再准备这项修改。" });
      if (action.type === "document_update") await writeVaultFile(resolved.root, resolved.relative, boundedText(action.content, 200_000));
      else {
        const before = await readVaultFile(resolved.root, resolved.relative);
        const addition = `\n\n> ${clean(action.text, 20_000).replace(/\s*\n+\s*/g, "\n> ")}\n\n来源: ${clean(action.source, 2_000)}\n`;
        await writeVaultFile(resolved.root, resolved.relative, `${before.replace(/\s*$/, "")}${addition}`);
      }
    }
    result = { path: resolved.relative, stamp: await fileStamp(resolved.root, resolved.relative) };
  } else if (["workspace_write", "workspace_edit", "workspace_powershell"].includes(action.type)) {
    if (action.permissionMode !== "developer" || record.permissionMode !== "developer") throw Object.assign(new Error("这项操作没有开发权限"), { status: 403 });
    if (action.type === "workspace_powershell") {
      const resolved = await resolveAgentMountPath(runtimeEnv, action.mountId, ".", { execute: true });
      const output = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", clean(action.command, 8_000)], { cwd: resolved.absolute, timeout: 60_000, windowsHide: true, maxBuffer: 2_000_000 });
      result = { mountId: action.mountId, stdout: clean(output.stdout, 20_000), stderr: clean(output.stderr, 20_000) };
    } else {
      const resolved = await resolveAgentMountPath(runtimeEnv, action.mountId, action.path, { write: true });
      if (await agentPathStamp(resolved.absolute) !== String(action.expectedStamp || "")) throw Object.assign(new Error("文件在确认前发生了变化，拒绝覆盖"), { status: 409 });
      let next = boundedText(action.content, 200_000);
      if (action.type === "workspace_edit") {
        const before = await fs.readFile(resolved.absolute, "utf8");
        const oldText = String(action.oldText || "");
        const first = before.indexOf(oldText);
        if (first < 0 || before.indexOf(oldText, first + oldText.length) >= 0) throw Object.assign(new Error("原片段不存在或不唯一，拒绝编辑"), { status: 409 });
        next = before.slice(0, first) + String(action.newText || "") + before.slice(first + oldText.length);
      }
      await atomicWrite(resolved.absolute, next);
      result = { mountId: action.mountId, path: resolved.relative };
    }
  } else if (["project_write", "project_edit", "powershell"].includes(action.type)) {
    if (action.permissionMode !== "developer" || record.permissionMode !== "developer") throw Object.assign(new Error("这项操作没有开发权限"), { status: 403 });
    if (action.type === "powershell") {
      const output = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", clean(action.command, 8_000)], { cwd: (await resolveProjectPath(".")).absolute, timeout: 60_000, windowsHide: true, maxBuffer: 2_000_000 });
      result = { stdout: clean(output.stdout, 20_000), stderr: clean(output.stderr, 20_000) };
    } else {
      const resolved = await resolveProjectPath(action.path, { write: true });
      let next = boundedText(action.content, 200_000);
      if (action.type === "project_edit") {
        const before = await fs.readFile(resolved.absolute, "utf8");
        const oldText = String(action.oldText || "");
        const first = before.indexOf(oldText);
        if (first < 0 || before.indexOf(oldText, first + oldText.length) >= 0) throw Object.assign(new Error("原片段不存在或不唯一，拒绝编辑"), { status: 409 });
        next = before.slice(0, first) + String(action.newText || "") + before.slice(first + oldText.length);
      }
      await atomicWrite(resolved.absolute, next);
      result = { path: resolved.relative };
    }
  } else {
    throw Object.assign(new Error("这项操作类型不能执行"), { status: 409 });
  }
  action.status = "applied";
  action.appliedAt = now();
  action.result = result;
  const saved = await writeConversationRecord(scopeId, record);
  return { conversation: saved, action, result };
}

export async function cancelAssistantTurn(scopeId, conversationId = "") {
  const record = await ensureConversation(scopeId, conversationId);
  const key = activeKey(scopeId, record.id);
  const running = active.get(key);
  if (!running) return false;
  running.cancelled = true;
  await running.session?.abort().catch(() => {});
  active.delete(key);
  await running.drain?.().catch(() => {});
  const latest = await readConversationRecord(scopeId, record.id).catch(() => null);
  if (latest?.activeTurn) {
    latest.lastTurn = { ...latest.activeTurn, status: "cancelled", finishedAt: now() };
    latest.activeTurn = null;
    await writeConversationRecord(scopeId, latest).catch(() => {});
  }
  return true;
}
