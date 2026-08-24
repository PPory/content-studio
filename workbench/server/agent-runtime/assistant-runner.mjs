import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { parsePdf } from "../lib/books.mjs";
import { searchAll } from "../lib/search.mjs";
import { createHarnessRun } from "./harness-adapter.mjs";

const ROOT = path.resolve(process.cwd(), ".xenho", "assistant");
const active = new Map();
const providerDispatcher = new EnvHttpProxyAgent();
const clean = (value, max = 80_000) => String(value || "").trim().slice(0, max);
const now = () => new Date().toISOString();
const scopeKey = (scopeId) => crypto.createHash("sha256").update(clean(scopeId, 240) || "global").digest("hex").slice(0, 24);
const scopeDir = (scopeId) => path.join(ROOT, scopeKey(scopeId));
const indexFile = (scopeId) => path.join(scopeDir(scopeId), "index.json");
const conversationDir = (scopeId, conversationId) => path.join(scopeDir(scopeId), "conversations", conversationId);
const conversationFile = (scopeId, conversationId) => path.join(conversationDir(scopeId, conversationId), "conversation.json");
const activeKey = (scopeId, conversationId) => `${clean(scopeId, 240)}:${conversationId}`;

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
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messageCount: Array.isArray(item.messages) ? item.messages.length : 0,
    preview: clean([...((item.messages || []))].reverse().find((message) => message.role === "user")?.text, 90),
  };
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
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
  return data;
}

async function readConversationRecord(scopeId, conversationId) {
  const id = safeConversationId(conversationId);
  if (!id) return null;
  try {
    const data = JSON.parse(await fs.readFile(conversationFile(scopeId, id), "utf8"));
    return {
      id,
      scopeId: clean(scopeId, 240),
      title: clean(data.title, 120) || "新对话",
      model: clean(data.model, 240),
      createdAt: data.createdAt || now(),
      updatedAt: data.updatedAt || data.createdAt || now(),
      messages: Array.isArray(data.messages) ? data.messages.slice(-120) : [],
      attachments: Array.isArray(data.attachments) ? data.attachments.slice(-40) : [],
    };
  } catch {
    return null;
  }
}

async function writeConversationRecord(scopeId, record) {
  const file = conversationFile(scopeId, record.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data = {
    id: record.id,
    scopeId: clean(scopeId, 240),
    title: clean(record.title, 120) || "新对话",
    model: clean(record.model, 240),
    createdAt: record.createdAt || now(),
    updatedAt: now(),
    messages: (record.messages || []).slice(-120),
    attachments: (record.attachments || []).slice(-40),
  };
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
  const index = await readIndex(scopeId);
  const summary = summaryOf(data);
  const items = [summary, ...index.items.filter((item) => item.id !== record.id)].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  await writeIndex(scopeId, { ...index, activeId: record.id, items });
  return data;
}

export async function createAssistantConversation(scopeId, options = {}) {
  const id = newConversationId();
  return writeConversationRecord(scopeId, {
    id,
    title: "新对话",
    model: clean(options.model, 240),
    createdAt: now(),
    messages: [],
    attachments: [],
  });
}

async function ensureConversation(scopeId, conversationId = "", options = {}) {
  const requested = safeConversationId(conversationId);
  if (requested) {
    const record = await readConversationRecord(scopeId, requested);
    if (record) return record;
  }
  const index = await readIndex(scopeId);
  if (index.activeId) {
    const record = await readConversationRecord(scopeId, index.activeId);
    if (record) return record;
  }
  try {
    const legacy = JSON.parse(await fs.readFile(path.join(scopeDir(scopeId), "conversation.json"), "utf8"));
    if (Array.isArray(legacy.messages) && legacy.messages.length) {
      const firstUser = legacy.messages.find((message) => message.role === "user")?.text;
      return writeConversationRecord(scopeId, {
        id: newConversationId(),
        title: titleFrom(firstUser || "历史对话"),
        model: clean(options.model, 240),
        createdAt: legacy.messages[0]?.createdAt || now(),
        messages: legacy.messages,
        attachments: [],
      });
    }
  } catch {}
  return createAssistantConversation(scopeId, options);
}

export async function assistantConversations(scopeId) {
  const current = await ensureConversation(scopeId);
  const index = await readIndex(scopeId);
  return { ...index, activeId: current.id };
}

export async function assistantConversation(scopeId, conversationId = "") {
  return ensureConversation(scopeId, conversationId);
}

export async function assistantModels(env) {
  const configured = clean(env.HARNESS_LLM_MODEL, 240);
  const base = clean(env.HARNESS_LLM_BASE_URL, 1_000).replace(/\/+$/, "");
  const key = clean(env.HARNESS_LLM_API_KEY, 4_000);
  if (!base || !key) return { items: configured ? [{ id: configured, name: configured }] : [], configured, source: "settings" };
  try {
    const response = await undiciFetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      dispatcher: providerDispatcher,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    const items = [...new Map(rows.map((item) => {
      const id = clean(typeof item === "string" ? item : item?.id || item?.name, 240);
      return id ? [id, { id, name: clean(item?.name, 240) || id, ownedBy: clean(item?.owned_by || item?.provider, 120) }] : null;
    }).filter(Boolean)).values()];
    if (configured && !items.some((item) => item.id === configured)) items.unshift({ id: configured, name: configured });
    return { items, configured, source: "provider" };
  } catch (error) {
    return { items: configured ? [{ id: configured, name: configured }] : [], configured, source: "settings", warning: `模型列表获取失败：${error.message}` };
  }
}

function searchQueries(input) {
  const text = `${input.document?.title || ""}\n${input.message || ""}\n${input.document?.selection?.text || ""}`;
  const quoted = [...text.matchAll(/[“\"《]([^”\"》]{2,30})[”\"》]/g)].map((match) => match[1]);
  const latin = text.match(/[A-Za-z][A-Za-z0-9._-]{2,36}/g) || [];
  const chinese = text.match(/[\u4e00-\u9fff]{2,12}/g) || [];
  return [...new Set([...quoted, ...latin, ...chinese, clean(input.document?.title, 36)])].filter(Boolean).slice(0, 2);
}

export function assistantRetrievalRequested(input = {}) {
  return /(搜索|搜一下|查一下|查找|检索|知识库|我的笔记|书里|找案例|找数据|找来源|出处|联网|事实核查|核实|查证)/i.test(`${input.message || ""} ${input.document?.selection?.text || ""}`);
}

async function localContext(env, input, record) {
  const asksForSources = assistantRetrievalRequested(input);
  const queries = asksForSources ? searchQueries(input) : [];
  const sources = [];
  const seen = new Set();
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
    attachments: (record.attachments || []).map(({ id, name, type, bytes, characters, textPath }) => ({ id, name, type, bytes, characters, textPath })),
  };
}

function contentPrompt(input, context) {
  const document = input.document || {};
  const selection = document.selection?.text ? `【当前选区】\n${clean(document.selection.text, 30_000)}` : "【当前选区】无；本轮默认围绕全文。";
  const body = clean(document.body, 60_000);
  const style = input.style?.instructions ? `【本篇调用风格：${clean(input.style.name || "未命名风格", 80)}】\n${clean(input.style.instructions, 8_000)}` : "【本篇调用风格】未指定；保持清楚、克制，不模仿不存在的个人口吻。";
  return [
    "你正在 Xenho OS 的内容项目中协助主创。先回答用户当前这一步，不抢走创作主导权。",
    "你可以分析、检索、提出建议或生成候选，但绝不能声称已经修改正文；正文只有用户点击采纳后才会变化。需要本地资料时调用 knowledge_search，需要时效性事实或公开证据时调用 web_search/web_fetch，读取附件时调用 attachment_read。",
    "来源不足就明确写不足，禁止编造个人经历、数字、引语和出处。如果用户要求改写，先说明你将给出候选，再给出可直接替换的文本。",
    `【当前内容】\n标题：${clean(document.title || "未命名", 300)}\n平台：${clean(document.platform, 50) || "未设置"}\n目标读者：${clean(document.audience, 200) || "沿用长期设置"}`,
    selection,
    body ? `【全文】\n${body}` : "【全文】尚未开始写。",
    style,
    `【可读取附件】${context.attachments.map((item) => `${item.id}：${item.name}`).join("；") || "无"}`,
    `【用户本轮输入】\n${clean(input.message, 8_000)}`,
  ].join("\n\n");
}

function generalPrompt(input, context) {
  return [
    "你正在 Xenho OS 的独立 AI 助手中进行通用对话。这不是一篇待写文章，也没有默认写作任务。请直接理解并回答用户此刻的问题。",
    "你可以处理一般问答、分析、规划、研究、内容创作和文件阅读。需要用户本地知识时调用 knowledge_search；需要新近公开信息时调用 web_search，并用 web_fetch 阅读关键来源；需要读取用户上传文件时调用 attachment_read。",
    "不要因为工作台与内容创作有关，就把普通问候解释为确定选题、搭结构或开始写稿。只有用户明确提出写作任务时才进入创作流程。不要声称执行了未实际调用的工具或修改。",
    `【可读取附件】${context.attachments.map((item) => `${item.id}：${item.name}（${item.characters || 0} 字符）`).join("；") || "无"}`,
    `【用户本轮输入】\n${clean(input.message, 8_000)}`,
  ].join("\n\n");
}

export async function runAssistantTurn(env, input = {}) {
  const startedAt = Date.now();
  const scopeId = clean(input.scopeId, 240);
  const message = clean(input.message, 8_000);
  if (!scopeId) throw Object.assign(new Error("缺少当前对话范围"), { status: 400 });
  if (!message) throw Object.assign(new Error("先写下想让 AI 帮你做什么"), { status: 400 });
  const record = await ensureConversation(scopeId, input.conversationId, { model: input.model || env.HARNESS_LLM_MODEL });
  const key = activeKey(scopeId, record.id);
  if (active.has(key)) throw Object.assign(new Error("AI 助手还在处理上一条消息"), { status: 409 });
  active.set(key, null);

  const dir = conversationDir(scopeId, record.id);
  await fs.mkdir(dir, { recursive: true });
  let context;
  try {
    const userMessage = { id: `user-${Date.now().toString(36)}`, role: "user", text: message, createdAt: now() };
    record.model = clean(input.model, 240) || record.model || clean(env.HARNESS_LLM_MODEL, 240);
    record.title = record.messages.length ? record.title : titleFrom(message);
    record.messages = [...record.messages, userMessage];
    await writeConversationRecord(scopeId, record);
    context = await localContext(env, input, record);
    await fs.writeFile(path.join(dir, "context.json"), JSON.stringify({ document: input.document || {}, ...context }, null, 2), "utf8");
  } catch (error) {
    active.delete(key);
    throw error;
  }

  let harness;
  try {
    const standalone = input.mode === "general";
    const result = await createHarnessRun({
      env,
      runDir: dir,
      kind: "assistant-chat",
      prompt: standalone ? generalPrompt(input, context) : contentPrompt(input, context),
      persona: standalone
        ? "你是 Xenho OS 的通用 AI 助手。直接回应用户真实意图，可调用知识库、公开网页、附件和 Harness Skill；不预设用户正在写文章，不伪造事实、来源、文件内容或已执行动作。"
        : "你是 Xenho OS 的内容项目助手。协助主创分析、检索和生成候选；不得静默改正文，不得伪造事实、来源或用户经历。",
      sessionRoot: path.join(dir, "sessions"),
      sessionId: `assistant-${record.id}`,
      maxTokens: 4096,
      model: record.model,
      onHarness(instance) { harness = instance; active.set(key, instance); },
    });
    const text = clean(result.result.finalResponse, 40_000);
    if (!text) throw new Error("Harness 已结束，但没有返回可显示的内容");
    const latest = await readConversationRecord(scopeId, record.id) || record;
    const assistantMessage = { id: `assistant-${Date.now().toString(36)}`, role: "assistant", text, createdAt: now(), engine: "DeepSeek Harness", model: record.model, durationMs: Date.now() - startedAt, retrievalMode: context.retrievalMode };
    latest.messages = [...latest.messages, assistantMessage];
    latest.model = record.model;
    const saved = await writeConversationRecord(scopeId, latest);
    return { conversation: saved, message: assistantMessage };
  } finally {
    active.delete(key);
    await harness?.close().catch(() => {});
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

export async function saveAssistantAttachment(scopeId, conversationId, fileName, bytes) {
  const record = await ensureConversation(scopeId, conversationId);
  if (!bytes?.length) throw Object.assign(new Error("没有收到文件内容"), { status: 400 });
  const name = safeUploadName(fileName);
  const text = await extractAttachment(name, bytes);
  const id = `file-${crypto.randomUUID().replaceAll("-", "")}`;
  const dir = path.join(conversationDir(scopeId, record.id), "attachments", id);
  await fs.mkdir(dir, { recursive: true });
  const originalPath = path.join(dir, name);
  const textPath = path.join(dir, "content.txt");
  await fs.writeFile(originalPath, bytes);
  await fs.writeFile(textPath, text.slice(0, 1_000_000), "utf8");
  const item = { id, name, type: path.extname(name).slice(1) || "text", bytes: bytes.length, characters: Math.min(text.length, 1_000_000), originalPath, textPath, createdAt: now() };
  record.attachments = [...record.attachments, item];
  const saved = await writeConversationRecord(scopeId, record);
  return { conversationId: saved.id, attachment: { id, name, type: item.type, bytes: item.bytes, characters: item.characters, createdAt: item.createdAt } };
}

export async function cancelAssistantTurn(scopeId, conversationId = "") {
  const record = await ensureConversation(scopeId, conversationId);
  const key = activeKey(scopeId, record.id);
  const harness = active.get(key);
  if (!harness) return false;
  await harness.close().catch(() => {});
  active.delete(key);
  return true;
}
