import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { documentVersion } from "../../src/lib/document-version.js";
import { createPiRun } from "./pi-runtime.mjs";
import { DELEGATABLE_EXPERT_KINDS, EXPERT_TASKS, expertPrompt, validateExpertReport } from "./expert-contracts.mjs";

const clean = (value, max = 80_000) => String(value ?? "").trim().slice(0, max);
const now = () => new Date().toISOString();
const settingKey = (id) => `expert-delegation:${id}`;
export const MAX_EXPERT_SUBAGENTS = 3;
export const EXPERT_READONLY_TOOLS = Object.freeze([
  "project_read",
  "workbench_projects",
  "material_evidence",
  "publication_metrics",
  "knowledge_search",
  "workspace_list",
  "workspace_search",
  "workspace_read",
  "hotspot_search",
  "attachment_read",
  "skill_read",
  "web_search",
  "web_fetch",
  "submit_expert_report",
]);

let activeExpertCount = 0;
const expertWaiters = [];
const activeRunIds = new Set();

function acquireExpertSlot(signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || Object.assign(new Error("专家委派已取消"), { name: "AbortError" }));
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeExpertCount = Math.max(0, activeExpertCount - 1);
      expertWaiters.shift()?.start();
    };
    const waiter = {
      start() {
        signal?.removeEventListener("abort", onAbort);
        activeExpertCount += 1;
        resolve(release);
      },
    };
    const onAbort = () => {
      const index = expertWaiters.indexOf(waiter);
      if (index >= 0) expertWaiters.splice(index, 1);
      reject(signal.reason || Object.assign(new Error("专家委派已取消"), { name: "AbortError" }));
    };
    if (activeExpertCount < MAX_EXPERT_SUBAGENTS) waiter.start();
    else {
      expertWaiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export function expertSubagentCatalog() {
  return DELEGATABLE_EXPERT_KINDS.map((kind) => ({ kind, ...EXPERT_TASKS[kind] }));
}

function persist(workspace, run) {
  const record = { ...run, updatedAt: now() };
  workspace.repository.setSetting(settingKey(record.id), record);
  return record;
}

function documentFromContext(context) {
  const source = context.project || context.document || {};
  return {
    id: clean(source.id, 180),
    title: clean(source.title, 300),
    body: String(source.body ?? ""),
    platform: clean(source.platform, 80),
    audience: clean(source.audience, 300),
    selection: source.selection?.text ? {
      from: Math.max(0, Number(source.selection.from) || 0),
      to: Math.max(0, Number(source.selection.to) || 0),
      text: String(source.selection.text),
    } : null,
  };
}

function recoverInterruptedRuns(workspace) {
  const rows = workspace.db.prepare("SELECT value_json FROM workspace_settings WHERE key LIKE 'expert-delegation:%'").all();
  for (const row of rows) {
    let run;
    try { run = JSON.parse(row.value_json); } catch { continue; }
    if (run?.status !== "running" || activeRunIds.has(run.id)) continue;
    persist(workspace, {
      ...run,
      status: "failed",
      stage: "failed",
      stageLabel: "上次检查因应用退出而中断",
      error: "专家检查没有正常结束",
      hint: "正文和已保存内容不受影响，可重新发起检查。",
      finishedAt: now(),
    });
  }
}

function localSources(workspace, context, document) {
  const query = [document.title, document.selection?.text || document.body].filter(Boolean).join(" ").slice(0, 300);
  const searched = query ? workspace.repository.search(query, { limit: 36 }) : [];
  const existing = Array.isArray(context.localSources) ? context.localSources : [];
  const result = [];
  const seen = new Set();
  for (const item of [...existing, ...searched]) {
    const id = clean(item?.id, 180) || `${clean(item?.title, 200)}:${result.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
    if (result.length >= 40) break;
  }
  return result;
}

async function runOne({ env, workspace, context, parentDir, scopeId, conversationId, model, kind, instruction, signal, batchId, executeRun }) {
  const task = EXPERT_TASKS[kind];
  const document = documentFromContext(context);
  const version = documentVersion(document);
  const id = `expert-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  activeRunIds.add(id);
  const runDir = path.join(parentDir, "subagents", batchId, kind);
  const sources = localSources(workspace, context, document);
  let run = persist(workspace, {
    id,
    kind,
    scopeId,
    parentConversationId: conversationId,
    delegated: true,
    documentVersion: version,
    status: "running",
    stage: "expert-run",
    stageLabel: `${task.expertName}正在独立检查`,
    percent: 24,
    localSourceCount: sources.length,
    piSessionId: crypto.randomUUID(),
    piSessionFile: "",
    createdAt: now(),
  });
  let session;
  let releaseSlot = () => {};
  const abort = () => session?.abort().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, "context.json"), JSON.stringify({ document, sources, instruction: clean(instruction, 2_000) }, null, 2), "utf8");
    releaseSlot = await acquireExpertSlot(signal);
    const result = await executeRun({
      env,
      runDir,
      kind,
      prompt: expertPrompt(kind, document, sources, instruction),
      persona: `你是 Xenho 的${task.expertName}子 Agent。你只负责${task.displayName}，独立核对证据并提交结构化报告；不得修改任何内容，不得委派其他 Agent。`,
      sessionRoot: path.join(runDir, "pi-sessions"),
      sessionId: run.piSessionId,
      model,
      mode: "daily",
      allowedTools: EXPERT_READONLY_TOOLS,
      context: {
        workspace,
        document,
        project: document,
        projectMaterials: context.projectMaterials || [],
        localSources: sources,
        attachments: context.attachments || [],
      },
      reportFile: path.join(runDir, "report.json"),
      onSession(instance, meta) {
        session = instance;
        run = persist(workspace, { ...run, piSessionId: meta.sessionId, piSessionFile: meta.sessionFile });
        if (signal?.aborted) abort();
      },
    });
    const report = validateExpertReport(kind, JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8")));
    run = persist(workspace, { ...run, piSessionId: result.piSessionId, piSessionFile: result.piSessionFile, status: "done", stage: "done", stageLabel: "检查完成", percent: 100, report, finishedAt: now() });
    return { id, kind, expertName: task.expertName, skillId: task.skillId, status: "done", documentVersion: version, report };
  } catch (error) {
    if (signal?.aborted) {
      persist(workspace, { ...run, status: "cancelled", stage: "cancelled", stageLabel: "已中止", error: "", hint: "正文和已保存内容不受影响。", finishedAt: now() });
      throw signal.reason || Object.assign(new Error("专家委派已取消"), { name: "AbortError" });
    }
    run = persist(workspace, { ...run, status: "failed", stage: "failed", stageLabel: "检查未完成", error: clean(error.message, 1_000), hint: clean(error.hint, 1_000) || "正文和已保存内容不受影响。", finishedAt: now() });
    return { id, kind, expertName: task.expertName, skillId: task.skillId, status: "failed", documentVersion: version, error: run.error, hint: run.hint };
  } finally {
    signal?.removeEventListener("abort", abort);
    releaseSlot();
    activeRunIds.delete(id);
    session?.dispose();
  }
}

export async function runExpertSubagents({ env, workspace, context, parentDir, scopeId, conversationId, model, kinds, instruction = "", signal, executeRun = createPiRun }) {
  if (!workspace?.db?.open) throw new Error("本地工作区尚未就绪");
  recoverInterruptedRuns(workspace);
  const document = documentFromContext(context);
  if (!document.body && !document.selection?.text) throw Object.assign(new Error("当前没有可交给专家检查的正文"), { status: 400 });
  const selected = [...new Set((Array.isArray(kinds) ? kinds : []).map((item) => clean(item, 40)))];
  if (!selected.length || selected.length > 3 || selected.some((kind) => !DELEGATABLE_EXPERT_KINDS.includes(kind))) {
    throw Object.assign(new Error("请选择 1 到 3 位可用的只读专家"), { status: 400 });
  }
  const batchId = `batch-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const settled = await Promise.allSettled(selected.map((kind) => runOne({ env, workspace, context, parentDir, scopeId, conversationId, model, kind, instruction, signal, batchId, executeRun })));
  const rejected = settled.find((item) => item.status === "rejected");
  if (rejected) throw rejected.reason;
  const results = settled.map((item) => item.value);
  return {
    batchId,
    mode: selected.length > 1 ? "parallel" : "single",
    documentVersion: documentVersion(document),
    requested: selected.length,
    completed: results.filter((item) => item.status === "done").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
    note: "各专家独立运行；报告是建议，不会修改正文或业务状态。汇总时保留冲突和证据不足项。",
  };
}
