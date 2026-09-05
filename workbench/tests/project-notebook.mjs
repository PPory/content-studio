import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { getProjectNotebook, saveProjectNotebook } from "../server/domain/project-notebook.mjs";
import { contentProjectRoutes } from "../server/routes/content-project.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-project-notebook-"));
const xenhoHome = path.join(root, "Xenho");
let workspace;
async function call(method, id, body) {
  let status, result;
  await contentProjectRoutes.find((r) => r.method === method && (method === "POST" ? r.path === "/api/workspace/explorations" : r.path.endsWith("/notebook"))).handler({
    workspace, params: { id }, req: Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]),
    res: { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } },
  });
  return { status, ...result };
}
try {
  workspace = await openWorkspace({ xenhoHome });
  const projectId = workspace.domain.createProject({ title: "只有一个疑问", actor: "user", confirmed: true });
  workspace.domain.createDraft({ projectId, bodyMarkdown: "既有正文不应改变。", actor: "user", confirmed: true });
  const before = workspace.db.prepare("SELECT * FROM drafts WHERE project_id=?").all(projectId);
  assert.equal(getProjectNotebook(workspace, projectId).version, 0);
  assert.equal(workspace.db.prepare("SELECT COUNT(*) AS n FROM project_notebooks").get().n, 0);
  const saved = await call("PUT", projectId, { expectedVersion: 0, thought: "为什么工具买了却不用？", questions: "还没有结论", alternatives: [{ id: "a", label: "从经历开始", body: "暂存候选" }], discovery: { selected: "a", candidates: [{ text: "尚未采纳" }] } });
  assert.equal(saved.status, 200);
  assert.equal(saved.notebook.version, 1);
  assert.equal((await call("PUT", projectId, { expectedVersion: 0, thought: "覆盖" })).status, 409);
  assert.equal((await call("GET", "missing")).status, 404);
  assert.equal((await call("PUT", "missing", { expectedVersion: 0 })).status, 404);
  let deep = {};
  for (let i = 0; i < 12; i++) deep = { child: deep };
  for (const patch of [
    { thought: 5 }, { audience: [] }, { questions: "x".repeat(10001) },
    { alternatives: [{ id: "", label: "", body: "" }] },
    { alternatives: Array.from({ length: 21 }, (_, i) => ({ id: String(i), label: "", body: "" })) },
    { alternatives: [{ id: "a", label: "", body: "" }, { id: "a", label: "", body: "" }] },
    { discovery: [] }, { discovery: deep }, { discovery: { text: "x".repeat(100001) } },
    { agendaId: "missing" }, { unknown: "no" }, { expectedVersion: -1 },
  ]) assert.equal((await call("PUT", projectId, { expectedVersion: 1, ...patch })).status, 400);
  const agendaId = workspace.contentBridge.createAgenda({ title: "长期方向", desiredJudgment: "帮助理解", actor: "user", confirmed: true });
  let next = saveProjectNotebook(workspace, projectId, { expectedVersion: 1, agendaId });
  assert.equal(next.thought, saved.notebook.thought);
  workspace.contentBridge.setAgendaArchived(agendaId, true, { actor: "user", confirmed: true });
  next = saveProjectNotebook(workspace, projectId, { expectedVersion: 2, questions: "可继续研究" });
  assert.equal(next.agendaId, agendaId);
  const secondId = workspace.domain.createProject({ title: "另一篇", actor: "user", confirmed: true });
  assert.equal((await call("PUT", secondId, { expectedVersion: 0, agendaId })).status, 400);
  assert.deepEqual(workspace.db.prepare("SELECT * FROM drafts WHERE project_id=?").all(projectId), before);
  assert.equal(workspace.db.prepare("SELECT COUNT(*) AS n FROM content_opportunities").get().n, 0);
  assert.equal(workspace.db.prepare("SELECT COUNT(*) AS n FROM wiki_pages").get().n, 0);
  workspace.close();
  workspace = await openWorkspace({ xenhoHome });
  assert.deepEqual(getProjectNotebook(workspace, projectId), next);
  assert.deepEqual(workspace.db.prepare("SELECT * FROM drafts WHERE project_id=?").all(projectId), before);
  const requestKey = crypto.randomUUID();
  const created = await call("POST", null, { requestKey, thought: "探索也能直接进入内容", discovery: { pending: true } });
  assert.equal(created.status, 200);
  const replay = await call("POST", null, { requestKey, thought: "探索也能直接进入内容", discovery: { pending: true } });
  assert.equal(replay.projectId, created.projectId, "retry must not duplicate a project");
  const draft = workspace.db.prepare("SELECT d.body_markdown FROM project_primary_drafts p JOIN drafts d ON d.id=p.draft_id WHERE p.project_id=?").get(created.projectId);
  assert.equal(draft.body_markdown, "");
  const counts = () => ["projects", "drafts", "project_notebooks", "entities"].map((name) => workspace.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n);
  const countsBefore = counts();
  assert.equal((await call("POST", null, { requestKey: crypto.randomUUID(), thought: [] })).status, 400);
  assert.deepEqual(counts(), countsBefore, "invalid notes roll back project, draft and entity creation");
  assert.equal((await call("POST", null, { requestKey: "invalid" })).status, 400);
  workspace.close();
  workspace = await openWorkspace({ xenhoHome });
  assert.equal((await call("POST", null, { requestKey })).projectId, created.projectId, "request key survives restart");
  console.log("✓ notebook API validation, CAS, partial saves, agenda boundaries, reopening and unchanged formal content");
} finally {
  workspace?.close();
  await fs.rm(root, { recursive: true, force: true });
}
