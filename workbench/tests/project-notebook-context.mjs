import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { getProjectNotebook, saveProjectNotebook } from "../server/domain/project-notebook.mjs";
import { projectCreativeContext, describeCreativeContext } from "../server/domain/content-project.mjs";
import { buildContentBridgeContext } from "../server/domain/content-bridge-context.mjs";
import { contentProjectRoutes } from "../server/routes/content-project.mjs";
import { createResearch, saveResearch, researchProject } from "../server/domain/research.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-notebook-context-"));
let workspace;
try {
  workspace = await openWorkspace({ xenhoHome: path.join(root, "Xenho") });
  const projectId = workspace.domain.createProject({ title: "只有疑问", actor: "user", confirmed: true });
  workspace.domain.createDraft({ projectId, bodyMarkdown: "既有正文", actor: "user" });
  const before = workspace.db.prepare("SELECT * FROM drafts").all();
  const empty = projectCreativeContext(workspace, projectId);
  assert.equal(empty.notebook.version, 0);
  assert.equal(empty.elements.length, 0);
  let status;
  await contentProjectRoutes.find((r) => r.path.endsWith("/creative-context")).handler({ workspace, params: { id: projectId }, res: { writeHead(value) { status = value; }, end(value) { assert.equal(JSON.parse(value).ok, true); } } });
  assert.equal(status, 200);
  const materialId = workspace.domain.createMaterial({ title: "实际资料", type: "案例/故事", bodyMarkdown: "数据库中的真实素材字节", actor: "user" });
  workspace.domain.linkMaterial(projectId, materialId, { actor: "user" });
  const wikiPageId = createUlid();
  const stamp = new Date().toISOString();
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id: wikiPageId, type: "wiki_page" });
    workspace.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, '真实词条', 'concept', '数据库中的真实知识摘要', '真实知识正文', 1, 1, ?, ?)`).run(wikiPageId, stamp, stamp);
  });
  saveProjectNotebook(workspace, projectId, { expectedVersion: 0, thought: "最新的疑问", intent: "让读者保留自己的判断", evidenceNotes: "候选待验证不能成为证据", discovery: { connection: { knowledgeAnchors: [
    { wikiPageId, body: "伪造的知识正文", title: "伪造标题" }, { wikiPageId: "fake-id", body: "虚构证据" },
  ] } } });
  const context = projectCreativeContext(workspace, projectId);
  assert.equal(context.elements.find((e) => e.sourceId === materialId).body, "数据库中的真实素材字节");
  assert.equal(context.elements.find((e) => e.sourceId === wikiPageId).body, "数据库中的真实知识摘要");
  assert.equal(context.elements.find((e) => e.sourceId === "fake-id").available, false);
  assert.equal(context.elements.find((e) => e.sourceId === "fake-id").body, "");
  const description = describeCreativeContext(context);
  assert.match(description, /最新的疑问/);
  assert.match(description, /让读者保留自己的判断/);
  assert.match(description, /优先于旧简报/);
  assert.doesNotMatch(description, /伪造的知识正文|虚构证据|伪造标题/);
  assert.match(description, /已失效，不要引用/);
  assert.deepEqual(workspace.db.prepare("SELECT * FROM drafts").all(), before);
  saveProjectNotebook(workspace, projectId, { expectedVersion: getProjectNotebook(workspace, projectId).version,
    discovery: { selectedId: "route-b", routes: [{ id: "route-b", construction: { route: { storyline: "采用后的讲法" }, elements: [{ id: "knowledge", type: "concept", source_kind: "wiki_page", source_id: wikiPageId, body: "不可信候选正文" }] } }] } });
  const selected = projectCreativeContext(workspace, projectId);
  assert.equal(selected.route.storyline, "采用后的讲法");
  assert.equal(selected.elements.find((item) => item.sourceId === wikiPageId).body, "数据库中的真实知识摘要");
  const research = createResearch(workspace, { question: "工具与任务如何配合", notes: "创建文章时的旧想法" });
  researchProject(workspace, research.id, { projectId });
  saveResearch(workspace, research.id, { expectedVersion: research.version, notes: "后续讨论提出新的边界条件", openQuestions: "这个判断何时不成立" });
  const currentResearchContext = projectCreativeContext(workspace, projectId);
  const currentResearchDescription = describeCreativeContext(currentResearchContext);
  assert.match(currentResearchDescription, /后续讨论提出新的边界条件/);
  assert.match(currentResearchDescription, /这个判断何时不成立/);
  assert.doesNotMatch(currentResearchDescription, /创建文章时的旧想法/);
  assert.match(currentResearchDescription, /关联选题的最新思考笔记（非已核实证据/);
  assert.equal(currentResearchContext.experiences.length, 0, "notes cannot become personal experience evidence");
  const hugeContext = { ...currentResearchContext, researches: Array.from({ length: 20 }, () => ({ question: "Q", notes: "x".repeat(100000), openQuestions: "y".repeat(20000) })) };
  assert(describeCreativeContext(hugeContext).length - describeCreativeContext({ ...hugeContext, researches: [] }).length < 20500, "linked note prompt remains bounded");
  assert.deepEqual(workspace.db.prepare("SELECT * FROM drafts").all(), before);
  // Legacy opportunity remains readable and only pre-fills an unsaved notebook.
  const agendaId = workspace.contentBridge.createAgenda({ title: "方向", desiredJudgment: "旧意图", actor: "user", confirmed: true });
  const problemId = workspace.contentBridge.createAudienceProblem({ statement: "旧问题", origin: "hypothesis", originAgendaId: agendaId, actor: "user", confirmed: true });
  const opportunityId = workspace.contentBridge.saveOpportunity({
    wikiPageId, audienceProblemId: problemId, agendaId, coreClaim: "旧简报判断", knowledgeExplanation: "旧知识解释", cognitiveGap: "旧差异",
    dominantAction: "judgment", fit: "strong", fitReason: "解释问题", construction: { elements: [{ id: "wiki", type: "concept", label: "知识", source_kind: "wiki_page", source_id: wikiPageId }] },
    freshness: buildContentBridgeContext(workspace, { wikiPageId, audienceProblemId: problemId, agendaId }).freshness, actor: "user", confirmed: true,
  });
  const legacyProjectId = workspace.contentBridge.createProjectFromOpportunity(opportunityId, { actor: "user", confirmed: true });
  const legacy = projectCreativeContext(workspace, legacyProjectId);
  assert.equal(legacy.opportunity.coreClaim, "旧简报判断");
  assert.equal(legacy.notebook.version, 0);
  assert.equal(legacy.notebook.thought, "旧简报判断");
  assert.equal(legacy.notebook.questions, "旧问题");
  saveProjectNotebook(workspace, legacyProjectId, { expectedVersion: 0, thought: "新的判断", intent: "新的意图" });
  const edited = describeCreativeContext(projectCreativeContext(workspace, legacyProjectId));
  assert(edited.indexOf("新的判断") < edited.indexOf("旧简报判断"));
  assert.match(edited, /新的意图/);
  assert.equal(workspace.contentBridge.projectOpportunity(legacyProjectId).coreClaim, "旧简报判断");
  // Bounded JSON is not necessarily the expected shape; malformed anchors cannot break writing.
  for (const anchors of [{}, "unexpected", null]) {
    saveProjectNotebook(workspace, projectId, { expectedVersion: getProjectNotebook(workspace, projectId).version, discovery: { connection: { knowledgeAnchors: anchors } } });
    assert.doesNotThrow(() => projectCreativeContext(workspace, projectId));
  }
  console.log("✓ creative context: blank projects, current notes, database evidence, legacy compatibility and no draft writes");
} finally {
  workspace?.close();
  await fs.rm(root, { recursive: true, force: true });
}
