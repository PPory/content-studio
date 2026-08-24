import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { searchAll } from "../lib/search.mjs";
import { createHarnessRun } from "./harness-adapter.mjs";

const ROOT = path.resolve(process.cwd(), ".xenho", "assistant");
const active = new Map();
const clean = (value, max = 80_000) => String(value || "").trim().slice(0, max);
const now = () => new Date().toISOString();
const scopeKey = (scopeId) => crypto.createHash("sha256").update(clean(scopeId, 240) || "global").digest("hex").slice(0, 24);
const scopeDir = (scopeId) => path.join(ROOT, scopeKey(scopeId));
const conversationFile = (scopeId) => path.join(scopeDir(scopeId), "conversation.json");

async function readConversation(scopeId) {
  try {
    const data = JSON.parse(await fs.readFile(conversationFile(scopeId), "utf8"));
    return { scopeId: clean(scopeId, 240), messages: Array.isArray(data.messages) ? data.messages.slice(-80) : [] };
  } catch {
    return { scopeId: clean(scopeId, 240), messages: [] };
  }
}

async function writeConversation(scopeId, messages) {
  const file = conversationFile(scopeId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data = { scopeId: clean(scopeId, 240), updatedAt: now(), messages: messages.slice(-80) };
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
  return data;
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

async function localContext(env, input) {
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
    sources.unshift({
      id,
      typeLabel: "项目素材",
      title: clean(item.title || "未命名素材", 200),
      snippet: clean(item.content || item.note || item.summary, 1_000),
      url: clean(item.sourceUrl || item.url, 1_000),
      source: "当前内容项目",
    });
  }
  return { queries, localSources: sources.slice(0, 40), retrievalMode: asksForSources ? "按需检索" : "未检索" };
}

function promptFor(input, context) {
  const document = input.document || {};
  const selection = document.selection?.text
    ? `【当前选区】\n${clean(document.selection.text, 30_000)}`
    : "【当前选区】无；本轮默认围绕全文。";
  const body = clean(document.body, 60_000);
  const style = input.style?.instructions
    ? `【本篇调用风格：${clean(input.style.name || "未命名风格", 80)}】\n${clean(input.style.instructions, 8_000)}`
    : "【本篇调用风格】未指定；保持清楚、克制，不模仿不存在的个人口吻。";
  return [
    "你正在 Xenho OS 的内容编辑页右栏里协助主创。",
    "先回答用户当前这一步，不抢走创作主导权。你可以分析、检索、提出建议或生成候选，但绝不能声称已经修改正文；正文只有用户点击采纳后才会变化。",
    "需要本地资料时调用 knowledge_search；需要时效性事实或公开证据时调用 web_search。来源不足就明确写不足，禁止编造个人经历、数字、引语和出处。",
    "如果用户要求改写，先说明你将给出候选，再给出可直接替换的文本；不要把建议和替换正文混在同一个段落里。",
    `【当前内容】\n标题：${clean(document.title || "未命名", 300)}\n平台：${clean(document.platform, 50) || "未设置"}\n目标读者：${clean(document.audience, 200) || "沿用长期设置"}`,
    selection,
    body ? `【全文】\n${body}` : "【全文】尚未开始写。",
    style,
    `【本轮检索】${context.retrievalMode}；已准备 ${context.localSources.length} 条候选来源；关键词：${context.queries.join("、") || "无"}`,
    `【用户本轮输入】\n${clean(input.message, 8_000)}`,
  ].join("\n\n");
}

export async function assistantConversation(scopeId) {
  return readConversation(scopeId);
}

export async function runAssistantTurn(env, input = {}) {
  const startedAt = Date.now();
  const scopeId = clean(input.scopeId, 240);
  const message = clean(input.message, 8_000);
  if (!scopeId) throw Object.assign(new Error("缺少当前内容范围"), { status: 400 });
  if (!message) throw Object.assign(new Error("先写下想让 AI 帮你做什么"), { status: 400 });
  if (active.has(scopeId)) throw Object.assign(new Error("AI 助手还在处理上一条消息"), { status: 409 });
  // 从写入用户消息前就占住范围，避免两次快速发送在 Harness 启动前同时穿过检查。
  active.set(scopeId, null);

  const dir = scopeDir(scopeId);
  await fs.mkdir(dir, { recursive: true });
  let context;
  try {
    const conversation = await readConversation(scopeId);
    const userMessage = { id: `user-${Date.now().toString(36)}`, role: "user", text: message, createdAt: now() };
    await writeConversation(scopeId, [...conversation.messages, userMessage]);
    const contextStartedAt = Date.now();
    context = await localContext(env, input);
    context.prepareMs = Date.now() - contextStartedAt;
    await fs.writeFile(path.join(dir, "context.json"), JSON.stringify({ document: input.document || {}, ...context }, null, 2), "utf8");
  } catch (error) {
    active.delete(scopeId);
    throw error;
  }

  let harness;
  const task = (async () => {
    try {
      const result = await createHarnessRun({
        env,
        runDir: dir,
        kind: "assistant-chat",
        prompt: promptFor(input, context),
        persona: "你是 Xenho OS 的 AI 助手。你在内容创作工作台内协助主创，可分析当前稿件、检索知识库和公开网页、调用工具并给候选方案。你不得静默改正文，不得伪造事实、来源或用户经历。",
        sessionRoot: path.join(dir, "sessions"),
        sessionId: `assistant-${scopeKey(scopeId)}`,
        maxTokens: 4096,
        onHarness(instance) { harness = instance; active.set(scopeId, instance); },
      });
      const text = clean(result.result.finalResponse, 40_000);
      if (!text) throw new Error("Harness 已结束，但没有返回可显示的内容");
      const latest = await readConversation(scopeId);
      const assistantMessage = { id: `assistant-${Date.now().toString(36)}`, role: "assistant", text, createdAt: now(), engine: "DeepSeek Harness", durationMs: Date.now() - startedAt, retrievalMode: context.retrievalMode };
      const saved = await writeConversation(scopeId, [...latest.messages, assistantMessage]);
      return { conversation: saved, message: assistantMessage };
    } finally {
      active.delete(scopeId);
      await harness?.close().catch(() => {});
    }
  })();
  return task;
}

export async function clearAssistantConversation(scopeId) {
  const dir = scopeDir(scopeId);
  await active.get(clean(scopeId, 240))?.close().catch(() => {});
  active.delete(clean(scopeId, 240));
  await fs.rm(dir, { recursive: true, force: true });
  return { scopeId: clean(scopeId, 240), messages: [] };
}

export async function cancelAssistantTurn(scopeId) {
  const key = clean(scopeId, 240);
  const harness = active.get(key);
  if (!harness) return false;
  await harness.close().catch(() => {});
  active.delete(key);
  return true;
}
