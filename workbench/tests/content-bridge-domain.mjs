import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openWorkspace } from "../server/storage/workspace.mjs";
import { buildContentBridgeContext } from "../server/domain/content-bridge-context.mjs";
import { validateContentConstruction } from "../server/domain/content-bridge.mjs";
import { createUlid } from "../server/storage/ids.mjs";
import { WORKSPACE_SCHEMA_VERSION } from "../server/storage/migrations.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-content-bridge-domain-"));
const xenhoHome = path.join(root, "Xenho");
const now = new Date("2026-09-01T08:00:00.000Z");
let workspace;

function check(name, value) {
  assert(value, name);
  console.log(` ✓ ${name}`);
}

function createWikiPage(target, { title = "认知卸载", summary = "把部分认知任务交给外部工具。", body = "# 认知卸载\n\n认知卸载帮助解释人如何把认知任务交给工具。" } = {}) {
  const id = createUlid();
  const stamp = now.toISOString();
  target.repository.transaction(() => {
    target.repository.createEntity({ id, type: "wiki_page", now });
    target.db.prepare(`INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,current_revision,schema_version,created_at,updated_at)
      VALUES (?, ?, 'concept', ?, ?, 1, 1, ?, ?)`)
      .run(id, title, summary, body, stamp, stamp);
    target.repository.setEntityText(id, { title, body, now });
  });
  return id;
}

try {
  workspace = await openWorkspace({ xenhoHome, now });
  const { db, contentBridge } = workspace;

  check("Content Bridge migration 已创建五张增量表", [
    "content_agendas",
    "audience_problems",
    "audience_problem_sources",
    "content_opportunities",
    "content_project_opportunities",
  ].every((name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)));
  check("工作区 Schema 已升级到用户问题来历版本", WORKSPACE_SCHEMA_VERSION === 13);

  assert.throws(() => contentBridge.createAgenda({ title: "判断权", desiredJudgment: "人应保留判断权", actor: "user", now }), /明确确认/);
  const agendaId = contentBridge.createAgenda({
    title: "保留人的判断权",
    audience: "高频使用 AI 的创作者",
    problemSpace: "怎样分配人与 AI 的判断责任",
    desiredJudgment: "高质量使用 AI 的核心是保留人的判断权",
    valueCommitment: "帮助用户建立可执行的判断边界",
    confirmed: true,
    actor: "user",
    now,
  });
  contentBridge.updateAgenda(agendaId, {
    title: "保留人的判断权",
    audience: "高频使用 AI 的知识工作者",
    problemSpace: "怎样分配人与 AI 的判断责任",
    desiredJudgment: "高质量使用 AI 的核心是保留人的判断权",
    valueCommitment: "帮助用户建立可执行的判断边界",
    confirmed: true,
    actor: "user",
    now: new Date(now.getTime() + 1_000),
  });
  check("Agenda 创建与更新保留核心判断", contentBridge.agenda(agendaId).audience.includes("知识工作者"));
  contentBridge.setAgendaArchived(agendaId, true, { confirmed: true, actor: "user", now: new Date(now.getTime() + 2_000) });
  check("Agenda 支持软归档且默认列表隐藏", contentBridge.agendas().length === 0 && contentBridge.agendas({ includeArchived: true })[0].status === "archived");
  contentBridge.setAgendaArchived(agendaId, false, { confirmed: true, actor: "user", now: new Date(now.getTime() + 3_000) });

  assert.throws(() => contentBridge.createAudienceProblem({ statement: "没有来源的问题", actor: "user", confirmed: true, now }), /至少需要一个/);
  const problemId = contentBridge.createAudienceProblem({
    statement: "AI 越用越方便，为什么我越来越不愿意自己想？",
    summary: "用户担心把越来越多判断任务交给 AI。",
    pattern: "knowledge_gap",
    sources: [{
      sourceKind: "comment",
      sourceId: "comment:ai-dependence:1",
      evidenceText: "现在遇到任何选择我都先问 AI，感觉自己懒得判断了。",
      observedAt: now,
    }],
    actor: "user",
    confirmed: true,
    now,
  });
  const problem = contentBridge.audienceProblem(problemId);
  check("Audience Problem 保存来源关系与逐字证据", problem.sources.length === 1 && problem.sources[0].evidenceText.includes("先问 AI"));
  check("观察到的问题 origin 默认是 observed", problem.origin === "observed" && problem.originAgendaId === null);

  // 议程推导出的问题是假设：没有观察来源，且必须永久可区分。
  assert.throws(() => contentBridge.createAudienceProblem({
    statement: "议程推导但缺议程",
    origin: "hypothesis",
    actor: "user",
    confirmed: true,
    now,
  }), /议程推导所属议程/);
  assert.throws(() => contentBridge.createAudienceProblem({
    statement: "假设不能带观察证据",
    origin: "hypothesis",
    originAgendaId: agendaId,
    sources: [{ sourceKind: "comment", sourceId: "comment:fake:1", evidenceText: "假装有人说过", observedAt: now }],
    actor: "user",
    confirmed: true,
    now,
  }), /不能携带观察证据/);
  assert.throws(() => contentBridge.createAudienceProblem({
    statement: "来历取值必须受支持",
    origin: "guess",
    actor: "user",
    confirmed: true,
    now,
  }), /来历不受支持/);

  const hypothesisId = contentBridge.createAudienceProblem({
    statement: "哪些事情可以交给 AI，哪些必须自己判断？",
    summary: "这条议程预测受众会卡在判断责任的边界上。",
    // 故意传一个会被服务端覆盖的 pattern 和 sourceKind，验证假设不接受调用方指定出处。
    pattern: "trend",
    sourceKind: "hotspot",
    sourceRef: "hotspot:pretend",
    origin: "hypothesis",
    originAgendaId: agendaId,
    actor: "user",
    confirmed: true,
    now,
  });
  const hypothesis = contentBridge.audienceProblem(hypothesisId);
  check("议程推导的问题标为假设并记住来源议程", hypothesis.origin === "hypothesis" && hypothesis.originAgendaId === agendaId);
  check("假设不写任何观察来源", hypothesis.sources.length === 0);
  check("假设的出处和模式由服务端钉死", hypothesis.sourceRef === `agenda:${agendaId}` && hypothesis.sourceKind === "manual" && hypothesis.pattern === "knowledge_gap");

  contentBridge.setAgendaArchived(agendaId, true, { confirmed: true, actor: "user", now: new Date(now.getTime() + 4_000) });
  assert.throws(() => contentBridge.createAudienceProblem({
    statement: "已归档议程不能继续推导",
    origin: "hypothesis",
    originAgendaId: agendaId,
    actor: "user",
    confirmed: true,
    now,
  }), /已归档议程/);
  contentBridge.setAgendaArchived(agendaId, false, { confirmed: true, actor: "user", now: new Date(now.getTime() + 5_000) });

  /**
   * 证据缺口的来源引用。真实跑第一轮就死在这儿：模型把 source_refs 给成了对象数组，
   * 旧代码 String() 成 "[object Object]" 再去比白名单，整次预览 400 挂掉。
   */
  const allowed = [{ sourceKind: "wiki_page", sourceId: "wiki-1" }];
  const gapShapes = validateContentConstruction({
    elements: [],
    evidence_gaps: [
      { claim: "对象形状的来源", source_refs: [{ source_kind: "wiki_page", source_id: "wiki-1" }] },
      { claim: "字符串形状的来源", source_refs: ["wiki-1"] },
      { claim: "认不出的来源", source_refs: ["ghost-source"] },
    ],
  }, { allowedSources: allowed });
  check("证据缺口来源同时接受字符串和 {source_id} 对象", gapShapes.evidence_gaps[0].source_refs[0] === "wiki-1"
    && gapShapes.evidence_gaps[1].source_refs[0] === "wiki-1");
  check("认不出的证据来源被丢掉，而不是让整次预览失败", gapShapes.evidence_gaps[2].source_refs.length === 0);
  assert.throws(() => validateContentConstruction({
    elements: [],
    evidence_gaps: [{ claim: "形状不对", source_refs: [{ note: "既不是 ID 也没有 source_id" }] }],
  }, { allowedSources: allowed }), /来源 ID 或带 source_id 的对象/);

  const wikiPageId = createWikiPage(workspace);
  const invalidConstruction = {
    elements: [{ id: "knowledge", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: wikiPageId }],
    relations: [{ from: "knowledge", to: "missing", type: "causal" }],
  };
  assert.throws(() => contentBridge.saveOpportunity({
    wikiPageId,
    audienceProblemId: problemId,
    agendaId,
    coreClaim: "AI 正从信息工具进入人的判断链",
    knowledgeExplanation: "认知卸载解释了人如何把认知任务交给外部工具。",
    cognitiveGap: "会用 AI 不等于应该把所有判断都交给 AI。",
    dominantAction: "judgment",
    fit: "strong",
    fitReason: "该知识能直接解释问题背后的机制。",
    construction: invalidConstruction,
    actor: "user",
    freshness: buildContentBridgeContext(workspace, { wikiPageId, audienceProblemId: problemId, agendaId }).freshness,
    confirmed: true,
    now,
  }), /两个不同的现有要素/);
  assert.throws(() => contentBridge.saveOpportunity({
    wikiPageId,
    audienceProblemId: problemId,
    coreClaim: "虚构经历",
    knowledgeExplanation: "解释",
    cognitiveGap: "差异",
    dominantAction: "experience",
    fit: "medium",
    fitReason: "测试",
    construction: { elements: [{ id: "story", type: "experience", label: "我最近发现自己什么都问 AI", source_kind: "material", source_id: "fake-experience" }] },
    actor: "user",
    confirmed: true,
    freshness: buildContentBridgeContext(workspace, { wikiPageId, audienceProblemId: problemId }).freshness,
    now,
  }), /真实来源/);

  const experiencePayload = (sourceId) => ({
    wikiPageId,
    audienceProblemId: problemId,
    coreClaim: "只有真实经历才能成为第一人称入口",
    knowledgeExplanation: "知识解释仍来自当前 Wiki。",
    cognitiveGap: "经历型表达不能等同于虚构第一人称。",
    dominantAction: "experience",
    fit: "medium",
    fitReason: "真实经历可以作为条件明确的表达入口。",
    construction: { elements: [{ id: "story", type: "experience", label: "一次真实的 AI 选择经历", source_kind: "material", source_id: sourceId }] },
    freshness: buildContentBridgeContext(workspace, { wikiPageId, audienceProblemId: problemId }).freshness,
    actor: "user",
    confirmed: true,
    now,
  });
  const realExperienceId = workspace.domain.createMaterial({
    title: "一次真实的 AI 选择经历",
    type: "个人经历",
    bodyMarkdown: "我曾在一次真实选择中先问 AI，随后重新核对自己的判断。",
    actor: "user",
    now,
  });
  const experienceOpportunityId = contentBridge.saveOpportunity(experiencePayload(realExperienceId));
  check("真实存在的个人经历素材可以通过服务端真实性校验", contentBridge.opportunity(experienceOpportunityId).construction.elements[0].source_id === realExperienceId);
  contentBridge.setOpportunityArchived(experienceOpportunityId, true, { actor: "user", confirmed: true, now });

  const wrongTypeId = workspace.domain.createMaterial({
    title: "不是个人经历的观点",
    type: "核心观点",
    bodyMarkdown: "这是一条观点，不是用户个人经历。",
    actor: "user",
    now,
  });
  assert.throws(() => contentBridge.saveOpportunity(experiencePayload(wrongTypeId)), /类型不符/);
  const deletedExperienceId = workspace.domain.createMaterial({
    title: "已删除的个人经历",
    type: "个人经历",
    bodyMarkdown: "这条经历随后被用户移入回收站。",
    actor: "user",
    now,
  });
  workspace.domain.softDeleteEntity(deletedExperienceId, { actor: "user", now });
  assert.throws(() => contentBridge.saveOpportunity(experiencePayload(deletedExperienceId)), /已删除/);
  check("类型不符和已删除的个人经历 source_id 均被拒绝", true);

  const opportunityId = contentBridge.saveOpportunity({
    wikiPageId,
    audienceProblemId: problemId,
    agendaId,
    coreClaim: "AI 最值得关注的变化之一，是从信息工具进入人的判断链",
    knowledgeExplanation: "认知卸载解释了人如何把认知任务交给外部工具。",
    cognitiveGap: "多数人把会用 AI 理解为尽量多交给 AI，但关键是判断权如何分配。",
    dominantAction: "judgment",
    fit: "strong",
    fitReason: "用户问题与知识解释之间存在直接机制关系。",
    construction: {
      elements: [
        { id: "problem", type: "problem", label: "为什么我越来越依赖 AI 判断", source_kind: "comment", source_id: "comment:ai-dependence:1" },
        { id: "knowledge", type: "concept", label: "认知卸载", source_kind: "wiki_page", source_id: wikiPageId },
        { id: "claim", type: "judgment", label: "需要重新分配判断权" },
      ],
      relations: [
        { from: "problem", to: "knowledge", type: "problem_to_mechanism", explanation: "知识解释问题机制" },
        { from: "knowledge", to: "claim", type: "support", explanation: "机制支撑核心判断" },
      ],
      entry_options: [{ text: "AI 越用越方便，为什么我越来越不愿意自己想？", scope_check: { status: "supported", reason: "正文能够解释依赖判断的机制" } }],
      evidence_gaps: [{ claim: "高频使用 AI 会削弱判断能力", needed: "需要直接研究证据" }],
      counterarguments: [{ claim: "把判断交给 AI 也可能释放精力", response: "需要区分低风险选择与关键判断" }],
    },
    actor: "user",
    freshness: buildContentBridgeContext(workspace, { wikiPageId, audienceProblemId: problemId, agendaId }).freshness,
    confirmed: true,
    now,
  });
  check("Opportunity 保存受校验的结构与三档 fit", contentBridge.opportunity(opportunityId).construction.relations.length === 2);

  const projectId = contentBridge.createProjectFromOpportunity(opportunityId, { actor: "user", confirmed: true, now });
  const replayProjectId = contentBridge.createProjectFromOpportunity(opportunityId, { actor: "user", confirmed: true, now });
  check("Opportunity 复用现有 Domain 创建项目且幂等建立关系", projectId === replayProjectId
    && db.prepare("SELECT COUNT(*) AS count FROM content_project_opportunities WHERE opportunity_id=?").get(opportunityId).count === 1
    && workspace.domain.projectStage(projectId).stage === "策划中");

  const anotherProjectId = workspace.domain.createProject({ title: "并发重复项目", actor: "user", confirmed: true, now });
  assert.throws(() => workspace.db.prepare(`INSERT INTO content_project_opportunities(project_id,opportunity_id,role,created_at)
    VALUES (?, ?, 'primary', ?)`).run(anotherProjectId, opportunityId, now.toISOString()), /UNIQUE/);
  check("数据库级唯一约束拒绝同一 Opportunity 的第二个 primary Project", workspace.db.prepare(`SELECT COUNT(*) AS count
    FROM content_project_opportunities WHERE opportunity_id=? AND role='primary'`).get(opportunityId).count === 1);
  workspace.domain.softDeleteEntity(anotherProjectId, { actor: "user", now });

  contentBridge.setOpportunityArchived(opportunityId, true, { actor: "user", confirmed: true, now: new Date(now.getTime() + 4_000) });
  check("Opportunity 支持归档并保留 Project Link", contentBridge.opportunities().length === 0
    && db.prepare("SELECT COUNT(*) AS count FROM content_project_opportunities WHERE opportunity_id=?").get(opportunityId).count === 1);
  contentBridge.setOpportunityArchived(opportunityId, false, { actor: "user", confirmed: true, now: new Date(now.getTime() + 5_000) });

  workspace.domain.softDeleteEntity(opportunityId, { actor: "user", now });
  assert.throws(() => contentBridge.opportunity(opportunityId), /不存在/);
  workspace.domain.restoreEntity(opportunityId, { actor: "user", now });
  check("Content Bridge 实体继续使用现有回收站机制", contentBridge.opportunity(opportunityId).id === opportunityId);

  workspace.close();
  workspace = await openWorkspace({ xenhoHome });
  check("关闭重开后 Agenda、Problem、Opportunity 与 Project Link 仍存在",
    workspace.contentBridge.agenda(agendaId).id === agendaId
    && workspace.contentBridge.audienceProblem(problemId).sources.length === 1
    && workspace.contentBridge.opportunity(opportunityId).id === opportunityId
    && workspace.contentBridge.projectOpportunity(projectId).id === opportunityId);
  check("重复打开 migration 幂等", workspace.db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count === WORKSPACE_SCHEMA_VERSION);
  check("Content Bridge 写操作均进入现有审计", workspace.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type LIKE 'content_%' OR event_type LIKE 'audience_problem.%'").get().count >= 6);
  check("数据库完整性与外键检查通过", workspace.check().ok);
} finally {
  workspace?.close();
  await fs.rm(root, { recursive: true, force: true });
}

console.log("\nContent Bridge 领域与 SQLite 测试通过。\n");
