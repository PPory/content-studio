import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { searchAll } from "../lib/search.mjs";
import { WRITING_EXPERTS } from "../lib/writing-presets.mjs";
import { qualityNinePrompt, XENHO_QUALITY_NINE } from "../lib/quality-nine.mjs";
import { createHarnessRun, harnessRuntimeInfo } from "./harness-adapter.mjs";

const ROOT = path.resolve(process.cwd(), ".xenho", "expert-runs");
const live = new Map();
const activeHarness = new Map();
const KINDS = new Set(["material-research", "quality-review", "fact-check", "style-calibration"]);
const clean = (value, max = 80_000) => String(value || "").trim().slice(0, max);
const now = () => new Date().toISOString();
const runFile = (id) => path.join(ROOT, id, "run.json");

async function persist(run) {
  run.updatedAt = now();
  await fs.mkdir(path.dirname(runFile(run.id)), { recursive: true });
  await fs.writeFile(runFile(run.id), JSON.stringify(run, null, 2), "utf8");
  live.set(run.id, run);
  return run;
}

function publicRun(run) {
  const { rawTrace: _rawTrace, ...safe } = run;
  return safe;
}

function searchQueries(document) {
  const text = `${document.title || ""}\n${document.selection?.text || document.body || ""}`;
  const quoted = [...text.matchAll(/[“\"《]([^”\"》]{2,24})[”\"》]/g)].map((m) => m[1]);
  const latin = text.match(/[A-Za-z][A-Za-z0-9._-]{2,30}/g) || [];
  const chinese = text.match(/[\u4e00-\u9fff]{2,10}/g) || [];
  return [...new Set([clean(document.title, 30), ...quoted, ...latin, ...chinese])].filter(Boolean).slice(0, 10);
}

async function localEvidence(env, document) {
  const queries = searchQueries(document);
  const found = [];
  const seen = new Set();
  for (const query of queries) {
    const result = await searchAll(env, query, { limit: 10 });
    for (const item of result.results || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      found.push({ ...item, matchedQuery: query });
      if (found.length >= 36) break;
    }
    if (found.length >= 36) break;
  }
  return { queries, sources: found };
}

function reportContract(kind) {
  if (kind === "material-research") return `{"kind":"material-research","summary":"...","claims":[{"quote":"正文观点","location":"段落线索","need":"需要的数据/案例/故事","localSources":[{"title":"...","url":"","path":"","excerpt":"...","why":"为什么适合"}],"webSources":[],"gap":"仍缺什么"}],"nextSteps":["..."]}`;
  if (kind === "quality-review") return `{"kind":"quality-review","summary":"...","strengths":[{"quote":"...","reason":"..."}],"questions":[{"id":"audience","status":"pass|warn|fail","location":"...","finding":"...","direction":"..."}],"mustFix":["..."]}`;
  if (kind === "fact-check") return `{"kind":"fact-check","summary":"...","claims":[{"quote":"...","type":"数字|日期|人物|事件|引语|绝对化判断","status":"verified|disputed|unsupported|overstated","localSources":[],"webSources":[{"title":"...","url":"...","excerpt":"..."}],"risk":"...","suggestion":"..."}]}`;
  return `{"kind":"style-calibration","summary":"...","dimensions":{"tone":"...","method":"...","thinking":"...","expression":"...","habits":"...","signature":"..."},"name":"我的风格","description":"...","instructions":"可直接交给写作模型的完整风格提示词","warnings":[]}`;
}

function promptFor(kind, document, context) {
  const expertId = { "material-research": "material-researcher", "quality-review": "quality-reviewer", "fact-check": "fact-checker", "style-calibration": "style-coach" }[kind];
  const expert = WRITING_EXPERTS.find((item) => item.id === expertId);
  const target = document.selection?.text ? `只分析以下选中段落：\n${document.selection.text}` : `分析全文：\n${document.body}`;
  const quality = kind === "quality-review" ? `\nXenho 品控九问：\n${qualityNinePrompt()}` : "";
  return `${expert?.instructions || ""}${quality}\n\n任务背景：\n标题：${document.title || "未命名"}\n平台：${document.platform || ""}\n目标读者：${document.audience || ""}\n${target}\n\n工作要求：\n1. 必须先调用 knowledge_search，研究或核查类任务还要针对关键主张调用 web_search；没有网页密钥时如实标记。\n2. 来源只能来自工具返回，不得凭记忆伪造出处。\n3. 不修改正文，只给定位、证据、判断和修改方向。\n4. 最后必须调用 submit_expert_report，reportJson 严格遵守下面结构；不要只在最终消息里贴 JSON。\n${reportContract(kind)}\n\n本地快照已有 ${context.localSources.length} 条候选来源，预检关键词：${context.queries.join("、") || "无"}。`;
}

function validateReport(kind, report) {
  if (!report || typeof report !== "object" || Array.isArray(report) || report.kind !== kind) throw new Error("专家没有提交符合约定的结构化报告");
  if (kind === "quality-review") {
    const ids = Array.isArray(report.questions) ? report.questions.map((item) => item?.id) : [];
    if (ids.length !== XENHO_QUALITY_NINE.length || XENHO_QUALITY_NINE.some((item) => !ids.includes(item.id))) {
      throw new Error("品控报告没有逐项回答完整的 Xenho 品控九问");
    }
  }
  if ((kind === "material-research" || kind === "fact-check") && !Array.isArray(report.claims)) throw new Error("专家报告缺少逐条观点或事实");
  if (kind === "style-calibration" && (!report.dimensions || !report.instructions)) throw new Error("风格画像缺少六维分析或提示词");
  return report;
}

async function execute(env, run, document) {
  const dir = path.dirname(runFile(run.id));
  let harness;
  let terminalFailure;
  try {
    Object.assign(run, { status: "running", stage: "local-search", stageLabel: "检索知识库与项目素材", percent: 12 });
    await persist(run);
    const evidence = await localEvidence(env, document);
    const context = { document, queries: evidence.queries, localSources: evidence.sources };
    await fs.writeFile(path.join(dir, "context.json"), JSON.stringify(context, null, 2), "utf8");
    Object.assign(run, { localSourceCount: evidence.sources.length, stage: "expert-run", stageLabel: run.kind === "quality-review" ? "逐项回答品控九问" : "专家正在研究并交叉核对", percent: 34 });
    await persist(run);
    const trace = [];
    const started = await createHarnessRun({ env, runDir: dir, kind: run.kind, prompt: promptFor(run.kind, document, context), onHarness(instance) {
      harness = instance;
      activeHarness.set(run.id, instance);
    }, onNotification(notification) {
      trace.push(notification);
      if (trace.length > 240) trace.shift();
      if (notification.method === "session.event") {
        const event = notification.params?.event;
        const type = event?.type || "";
        if (type === "tool/call") Object.assign(run, { stage: "tool-use", stageLabel: "查找并核对来源", percent: Math.max(run.percent, 56) });
        if (type === "tool/result") run.percent = Math.min(86, run.percent + 8);
        if (type === "llm/retry") {
          const retry = Number(event.data?.retry) || 1;
          const maxRetries = Number(event.data?.maxRetries) || 5;
          Object.assign(run, { stage: "model-retry", stageLabel: `模型连接中断，正在重试 ${retry}/${maxRetries}`, percent: Math.max(run.percent, 38) });
        }
        if (type === "turn/end" && event.data?.reason?.kind === "error") terminalFailure = event.data.reason.error;
      }
    } });
    harness = started.harness;
    if (terminalFailure) {
      const code = clean(terminalFailure.code, 80);
      const transport = code === "TRANSPORT" || /connection|network|fetch/i.test(terminalFailure.message || "");
      throw Object.assign(new Error(transport ? "专家模型连接失败" : `专家执行失败${code ? `（${code}）` : ""}`), {
        hint: transport
          ? "已读取你配置的 URL、模型和密钥，但请求未能连通模型服务。请确认模型地址可访问、本机网络或代理正在运行，然后重试。"
          : clean(terminalFailure.message, 500) || "可以重试；普通写作和正文保存不受影响。",
      });
    }
    Object.assign(run, { rawTrace: trace, stage: "validate", stageLabel: "整理结构化报告", percent: 92 });
    await persist(run);
    let reportJson;
    try {
      reportJson = await fs.readFile(path.join(dir, "report.json"), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw Object.assign(new Error("专家没有交付报告"), { hint: "模型已结束回答，但没有按约定提交检查报告。请重试一次。" });
    }
    const report = validateReport(run.kind, JSON.parse(reportJson));
    Object.assign(run, { status: "done", stage: "done", stageLabel: "检查完成", percent: 100, report, finishedAt: now() });
    await persist(run);
  } catch (error) {
    if (run.status !== "cancelled") {
      Object.assign(run, { status: "failed", stage: "failed", stageLabel: "检查未完成", error: error.message, hint: error.hint || "可以重试；普通写作和正文保存不受影响。", finishedAt: now() });
      await persist(run);
    }
  } finally {
    activeHarness.delete(run.id);
    await harness?.close().catch(() => {});
  }
}

export async function startExpertRun(env, input = {}) {
  const kind = clean(input.kind, 40);
  if (!KINDS.has(kind)) throw Object.assign(new Error("未知专家任务"), { status: 400 });
  const document = {
    title: clean(input.document?.title, 300), body: clean(input.document?.body), platform: clean(input.document?.platform, 40), audience: clean(input.document?.audience, 200),
    selection: input.document?.selection?.text ? { from: Math.max(0, Number(input.document.selection.from) || 0), to: Math.max(0, Number(input.document.selection.to) || 0), text: clean(input.document.selection.text, 30_000) } : null,
  };
  if (kind !== "style-calibration" && !document.body && !document.selection?.text) throw Object.assign(new Error("先写一点正文，专家才有检查对象"), { status: 400 });
  const id = `expert-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const run = await persist({ id, kind, scopeId: clean(input.scopeId, 160), status: "queued", stage: "queued", stageLabel: "准备专家任务", percent: 2, createdAt: now() });
  void execute(env, run, document);
  return publicRun(run);
}

export async function getExpertRun(id) {
  if (live.has(id)) return publicRun(live.get(id));
  try { return publicRun(JSON.parse(await fs.readFile(runFile(id), "utf8"))); } catch { return null; }
}

export async function listExpertRuns(scopeId = "") {
  await fs.mkdir(ROOT, { recursive: true });
  const ids = await fs.readdir(ROOT).catch(() => []);
  return (await Promise.all(ids.slice(-80).map(getExpertRun))).filter(Boolean).filter((run) => !scopeId || run.scopeId === scopeId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function cancelExpertRun(id) {
  const run = live.get(id) || await getExpertRun(id);
  if (!run) return null;
  if (["done", "failed", "cancelled"].includes(run.status)) return run;
  Object.assign(run, { status: "cancelled", stage: "cancelled", stageLabel: "已中止", finishedAt: now() });
  await persist(run);
  await activeHarness.get(id)?.close().catch(() => {});
  return publicRun(run);
}

export { harnessRuntimeInfo };
