import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApi } from "../server/api.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { openWorkspace } from "../server/storage/workspace.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-bridge-save-api-"));
const workspace = await openWorkspace({ xenhoHome: path.join(root, "Xenho") });
const now = new Date("2026-09-01T08:00:00.000Z");
let server;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

function createWikiPage() {
  const id = createUlid();
  const stamp = now.toISOString();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "wiki_page", now });
    workspace.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, '认知卸载', 'concept', '把认知任务交给外部工具。', '# 认知卸载\n\n它解释人如何把认知任务交给外部工具。', 1, 1, ?, ?)`)
      .run(id, stamp, stamp);
    workspace.repository.setEntityText(id, { title: "认知卸载", body: "它解释人如何把认知任务交给外部工具。", now });
  });
  return id;
}

async function call(base, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { origin: base } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, value: await response.json() };
}

try {
  const api = createApi({}, { workspace: Promise.resolve(workspace) });
  server = http.createServer((req, res) => api(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const wikiPageId = createWikiPage();
  const agendaId = workspace.contentBridge.createAgenda({
    title: "保留人的判断权",
    desiredJudgment: "高质量使用 AI 的核心是保留人的判断权",
    actor: "user",
    confirmed: true,
    now,
  });
  const audienceProblemId = workspace.contentBridge.createAudienceProblem({
    statement: "AI 越用越方便，为什么我越来越不愿意自己判断？",
    summary: "用户担心把判断任务交给 AI。",
    pattern: "knowledge_gap",
    sources: [{ sourceKind: "feedback", sourceId: "feedback:1", evidenceText: "遇到任何选择都会先问 AI。", observedAt: now }],
    actor: "user",
    confirmed: true,
    now,
  });
  const candidate = {
    wikiPageId,
    audienceProblemId,
    agendaId,
    coreClaim: "AI 正从信息工具进入人的判断链。",
    knowledgeExplanation: "认知卸载解释了人如何把认知任务交给外部工具。",
    cognitiveGap: "会用 AI 不等于应该把关键判断都交给 AI。",
    dominantAction: "judgment",
    fit: "strong",
    fitReason: "知识能够直接解释问题机制。",
    construction: {
      elements: [
        { id: "problem", type: "problem", label: "依赖 AI 判断", source_kind: "audience_problem", source_id: audienceProblemId },
        { id: "knowledge", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: wikiPageId },
      ],
      relations: [{ from: "problem", to: "knowledge", type: "problem_to_mechanism", explanation: "知识解释问题机制" }],
      entry_options: [{ text: "为什么 AI 越用越方便，我却越来越不愿意自己想？", scope_check: { status: "supported", reason: "正文能够解释依赖机制" } }],
      evidence_gaps: [],
      counterarguments: [{ claim: "外包低风险判断可以释放精力", response: "需要区分低风险与关键判断" }],
    },
  };

  const unconfirmed = await call(base, "/api/workspace/content-opportunities", { method: "POST", body: candidate });
  check("保存 API 拒绝未确认 Candidate 且不写库", unconfirmed.response.status === 400
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === 0);

  const missingWiki = await call(base, "/api/workspace/content-opportunities", {
    method: "POST",
    body: { ...candidate, wikiPageId: "missing", confirmed: true },
  });
  check("保存 API 拒绝失效 Wiki 引用", missingWiki.response.status === 404
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === 0);

  const saved = await call(base, "/api/workspace/content-opportunities", {
    method: "POST",
    body: { ...candidate, confirmed: true },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.value));
  const opportunityId = saved.value.opportunity.id;
  check("用户确认后才保存完整内容机会", saved.value.opportunity.coreClaim === candidate.coreClaim
    && saved.value.opportunity.construction.entry_options[0].scope_check.status === "supported"
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === 1);

  const listed = await call(base, "/api/workspace/content-opportunities");
  const detail = await call(base, `/api/workspace/content-opportunities/${opportunityId}`);
  check("内容机会可列表和按 ID 读取", listed.value.opportunities[0].id === opportunityId
    && detail.value.opportunity.wikiPageId === wikiPageId
    && detail.value.opportunity.audienceProblemId === audienceProblemId
    && detail.value.opportunity.agendaId === agendaId);


  const unconfirmedProject = await call(base, `/api/workspace/content-opportunities/${opportunityId}/project`, {
    method: "POST",
    body: {},
  });
  check("未确认时不能从 Opportunity 建立项目", unconfirmedProject.response.status === 400
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count === 0);

  const createdProject = await call(base, `/api/workspace/content-opportunities/${opportunityId}/project`, {
    method: "POST",
    body: { confirmed: true },
  });
  assert.equal(createdProject.response.status, 200, JSON.stringify(createdProject.value));
  const projectId = createdProject.value.projectId;
  const repeatedProject = await call(base, `/api/workspace/content-opportunities/${opportunityId}/project`, {
    method: "POST",
    body: { confirmed: true },
  });
  const contentIntent = await call(base, `/api/workspace/projects/${projectId}/content-intent`);
  check("项目复用现有 Domain、幂等关联并可回溯创作意图", projectId
    && repeatedProject.value.projectId === projectId
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM projects").get().count === 1
    && contentIntent.value.intent.opportunity.id === opportunityId
    && contentIntent.value.intent.wiki.id === wikiPageId
    && contentIntent.value.intent.problem.id === audienceProblemId
    && contentIntent.value.intent.agenda.id === agendaId
    && contentIntent.value.intent.evidenceGaps.length === 0);

  const invalidConstruction = await call(base, "/api/workspace/content-opportunities", {
    method: "POST",
    body: { ...candidate, construction: { ...candidate.construction, relations: [{ from: "missing", to: "knowledge", type: "support" }] }, confirmed: true },
  });
  check("服务端拒绝无效内容构造 Schema", invalidConstruction.response.status === 400
    && workspace.db.prepare("SELECT COUNT(*) AS count FROM content_opportunities").get().count === 1);

  const unconfirmedArchive = await call(base, `/api/workspace/content-opportunities/${opportunityId}/update`, {
    method: "POST",
    body: { action: "archive" },
  });
  check("归档内容机会也需要用户确认", unconfirmedArchive.response.status === 400);
  const archived = await call(base, `/api/workspace/content-opportunities/${opportunityId}/update`, {
    method: "POST",
    body: { action: "archive", confirmed: true },
  });
  check("内容机会支持可恢复归档", archived.value.opportunity.status === "archived"
    && (await call(base, "/api/workspace/content-opportunities")).value.opportunities.length === 0
    && (await call(base, "/api/workspace/content-opportunities?archived=1")).value.opportunities.length === 1);
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  workspace.close();
  await fs.rm(root, { recursive: true, force: true });
}

console.log("\nContent Opportunity 保存 API 测试通过。\n");
