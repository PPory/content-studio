import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fail, json, readJsonBody } from "../lib/http.mjs";
import { documentVersion } from "../../src/lib/document-version.js";
import { createPiRun, piRuntimeInfo } from "../agent-runtime/pi-runtime.mjs";
import { EXPERT_TASKS, expertPrompt, validateExpertReport } from "../agent-runtime/expert-contracts.mjs";

const KINDS = new Set(Object.keys(EXPERT_TASKS));
const active = new Map();
const executing = new Set();
const clean = (value, max = 80_000) => String(value ?? "").trim().slice(0, max);
const now = () => new Date().toISOString();
const settingKey = (id) => `expert-run:${id}`;

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) { fail(context.res, error.message || "本地专家任务失败", { status: error.status || 500, hint: error.hint }); }
  };
}

function publicRun(run) {
  const { idempotencyKey: _key, ...visible } = run;
  return visible;
}

function persist(workspace, run) {
  const record = { ...run, updatedAt: now() };
  workspace.repository.setSetting(settingKey(run.id), record);
  return record;
}

function load(workspace, id) {
  return workspace.repository.getSetting(settingKey(clean(id, 120)), null);
}

function list(workspace, scopeId = "") {
  return workspace.db.prepare("SELECT value_json FROM workspace_settings WHERE key LIKE 'expert-run:%' ORDER BY updated_at DESC LIMIT 100").all()
    .map((row) => { try { return JSON.parse(row.value_json); } catch { return null; } })
    .filter((run) => run && (!scopeId || run.scopeId === scopeId));
}

async function execute(env, workspace, run, document) {
  const dir = path.join(workspace.paths.stagingDir, "expert-runs", run.id);
  let session;
  try {
    run = persist(workspace, { ...run, status: "running", stage: "local-search", stageLabel: "检索当前本地工作区", percent: 12 });
    const query = [document.title, document.selection?.text || document.body].filter(Boolean).join(" ").slice(0, 300);
    const sources = workspace.repository.search(query, { limit: 36 });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "context.json"), JSON.stringify({ document, sources }, null, 2), "utf8");
    run = persist(workspace, { ...run, localSourceCount: sources.length, stage: "expert-run", stageLabel: "专家正在核对", percent: 34 });
    const result = await createPiRun({
      env,
      runDir: dir,
      kind: run.kind,
      sessionRoot: path.join(dir, "pi-sessions"),
      sessionId: run.piSessionId,
      prompt: expertPrompt(run.kind, document, sources),
      persona: "你是 Xenho 的专业内容顾问。用户是主创。只读研究、保留来源、提交结构化报告；不得修改正文、业务状态或文件。",
      mode: "daily",
      context: { workspace, document, localSources: sources },
      reportFile: path.join(dir, "report.json"),
      onSession(instance, meta) {
        session = instance;
        active.set(run.id, instance);
        run.piSessionId = meta.sessionId;
        run.piSessionFile = meta.sessionFile;
      },
    });
    run.piSessionId = result.piSessionId;
    run.piSessionFile = result.piSessionFile;
    run = persist(workspace, { ...run, stage: "validate", stageLabel: "整理结构化报告", percent: 92 });
    const report = validateExpertReport(run.kind, JSON.parse(await fs.readFile(path.join(dir, "report.json"), "utf8")));
    persist(workspace, { ...run, status: "done", stage: "done", stageLabel: "检查完成", percent: 100, report, finishedAt: now() });
  } catch (error) {
    const current = load(workspace, run.id) || run;
    if (current.status !== "cancelled") persist(workspace, { ...current, status: "failed", stage: "failed", stageLabel: "检查未完成", error: error.message, hint: error.hint || "可以重试；正文和已保存内容不受影响。", finishedAt: now() });
  } finally {
    executing.delete(run.id);
    active.delete(run.id);
    session?.dispose();
  }
}

function documentInput(input) {
  return {
    id: clean(input.document?.id, 180),
    title: clean(input.document?.title, 300),
    body: clean(input.document?.body),
    platform: clean(input.document?.platform, 80),
    audience: clean(input.document?.audience, 300),
    selection: input.document?.selection?.text ? { from: Math.max(0, Number(input.document.selection.from) || 0), to: Math.max(0, Number(input.document.selection.to) || 0), text: clean(input.document.selection.text, 30_000) } : null,
  };
}

export const localExpertRoutes = [
  { method: "GET", path: "/api/expert-runtime", handler: guard(async ({ env, res }) => json(res,{ok:true,runtime:await piRuntimeInfo(env),storage:"SQLite workspace"})) },
  { method: "POST", path: "/api/expert-runs", handler: guard(async ({ env, workspace, req, res }) => { const input=await readJsonBody(req); const kind=clean(input.kind,40); if(!KINDS.has(kind)) throw Object.assign(new Error("未知专家任务"),{status:400}); const document=documentInput(input); if(kind!=="style-calibration"&&!document.body&&!document.selection?.text) throw Object.assign(new Error("先写一点正文，专家才有检查对象"),{status:400}); const scopeId=clean(input.scopeId,160); const version=clean(input.documentVersion,180)||documentVersion(document); const target=document.selection?.text?`${document.selection.from}:${document.selection.to}`:"full"; const baseKey=crypto.createHash("sha256").update(`${kind}\n${scopeId}\n${version}\n${target}`).digest("hex"); const key=input.force?`${baseKey}:${Date.now().toString(36)}`:baseKey; const existing=list(workspace,scopeId).find((item)=>item.idempotencyKey===key); if(existing)return json(res,{ok:true,run:publicRun(existing)},202); const id=`expert-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`; const run=persist(workspace,{id,kind,scopeId,documentVersion:version,idempotencyKey:key,piSessionId:crypto.randomUUID(),piSessionFile:"",status:"queued",stage:"queued",stageLabel:"准备专家任务",percent:2,createdAt:now()}); executing.add(id); void execute(env,workspace,run,document); json(res,{ok:true,run:publicRun(run)},202); }) },
  { method: "GET", path: "/api/expert-runs", handler: guard(async ({ workspace, res, url }) => json(res,{ok:true,runs:list(workspace,clean(url.searchParams.get("scope"),160)).map(publicRun)})) },
  { method: "GET", path: "/api/expert-runs/:id", handler: guard(async ({ workspace, res, params }) => { let run=load(workspace,params.id); if(!run) return fail(res,"找不到这次专家任务",{status:404}); if(["queued","running"].includes(run.status)&&!executing.has(run.id)) run=persist(workspace,{...run,status:"failed",stage:"interrupted",stageLabel:"任务因工作台重启而中断",error:"上次专家任务没有正常结束",hint:"正文和已保存内容不受影响；可从当前正文重新检查。",finishedAt:now()}); json(res,{ok:true,run:publicRun(run)}); }) },
  { method: "POST", path: "/api/expert-runs/:id/cancel", handler: guard(async ({ workspace, res, params }) => { const current=load(workspace,params.id); if(!current)return fail(res,"找不到这次专家任务",{status:404}); const run=["done","failed","cancelled"].includes(current.status)?current:persist(workspace,{...current,status:"cancelled",stage:"cancelled",stageLabel:"已中止",finishedAt:now()}); await active.get(run.id)?.abort().catch(()=>{}); json(res,{ok:true,run:publicRun(run)}); }) },
];
