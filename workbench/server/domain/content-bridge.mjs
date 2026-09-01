import { createUlid } from "../storage/ids.mjs";

const SOURCE_KINDS = new Set(["hotspot", "insight_report", "social_post", "comment", "feedback", "manual"]);
const PROBLEM_PATTERNS = new Set(["trend", "frequency", "knowledge_gap", "feedback"]);
const FITS = new Set(["strong", "medium", "weak"]);
const DOMINANT_ACTIONS = new Set(["knowledge", "judgment", "experience", "demonstration"]);
const ELEMENT_TYPES = new Set(["concept", "fact", "case", "experience", "judgment", "problem", "evidence", "method", "analogy", "conflict", "observation"]);
const RELATION_TYPES = new Set(["causal", "analogy", "contrast", "conflict", "support", "challenge", "concept_to_case", "case_to_abstraction", "problem_to_mechanism", "mechanism_to_method"]);
const SCOPE_STATUSES = new Set(["supported", "too_broad"]);

const isoNow = (now = new Date()) => new Date(now).toISOString();
const clean = (value) => String(value ?? "").trim();

function required(value, label, max = Infinity) {
  const result = clean(value);
  if (!result) throw new TypeError(`${label}不能为空`);
  if (result.length > max) throw new TypeError(`${label}不能超过 ${max} 字`);
  return result;
}

function optional(value, label, max) {
  const result = clean(value);
  if (result.length > max) throw new TypeError(`${label}不能超过 ${max} 字`);
  return result;
}

function requireConfirmedUser({ actor, confirmed }, action) {
  if (actor !== "user") throw new Error(`${action}只能由用户执行`);
  if (confirmed !== true) throw new Error(`${action}必须来自用户明确确认`);
}

function array(value, label, max = 50) {
  if (!Array.isArray(value)) throw new TypeError(`${label}必须是数组`);
  if (value.length > max) throw new TypeError(`${label}不能超过 ${max} 项`);
  return value;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}必须是对象`);
  return value;
}

function normalizeElement(value, index) {
  const item = record(value, `内容要素 ${index + 1}`);
  const type = required(item.type, `内容要素 ${index + 1} 类型`, 40);
  if (!ELEMENT_TYPES.has(type)) throw new TypeError(`内容要素 ${index + 1} 类型不受支持`);
  const id = optional(item.id || `element-${index + 1}`, `内容要素 ${index + 1} ID`, 120);
  const label = required(item.label || item.content, `内容要素 ${index + 1} 内容`, 4000);
  const sourceKind = optional(item.source_kind || item.sourceKind, `内容要素 ${index + 1} 来源类型`, 80);
  const sourceId = optional(item.source_id || item.sourceId, `内容要素 ${index + 1} 来源`, 500);
  if (type === "experience" && !sourceId) throw new Error("经历要素必须携带真实来源，不能保存无依据的第一人称经历");
  return { id, type, label, source_kind: sourceKind, source_id: sourceId };
}

function normalizeRelation(value, index, elementIds) {
  const item = record(value, `要素关系 ${index + 1}`);
  const type = required(item.type, `要素关系 ${index + 1} 类型`, 60);
  if (!RELATION_TYPES.has(type)) throw new TypeError(`要素关系 ${index + 1} 类型不受支持`);
  const from = required(item.from, `要素关系 ${index + 1} 起点`, 120);
  const to = required(item.to, `要素关系 ${index + 1} 终点`, 120);
  if (from === to || !elementIds.has(from) || !elementIds.has(to)) throw new TypeError(`要素关系 ${index + 1} 必须连接两个不同的现有要素`);
  return { from, to, type, explanation: optional(item.explanation, `要素关系 ${index + 1} 说明`, 2000) };
}

function normalizeEntryOption(value, index) {
  const item = typeof value === "string" ? { text: value } : record(value, `大众入口 ${index + 1}`);
  const scope = item.scope_check || item.scopeCheck || {};
  const status = clean(scope.status || item.scope_status || "supported");
  if (!SCOPE_STATUSES.has(status)) throw new TypeError(`大众入口 ${index + 1} 的范围检查状态无效`);
  return {
    text: required(item.text || item.entry, `大众入口 ${index + 1}`, 1000),
    scope_check: {
      status,
      reason: required(scope.reason || item.scope_reason || (status === "supported" ? "后续内容能够回答这个问题" : "入口承诺超过现有内容范围"), `大众入口 ${index + 1} 范围说明`, 2000),
    },
  };
}

function normalizeEvidenceGap(value, index) {
  const item = typeof value === "string" ? { claim: value } : record(value, `证据缺口 ${index + 1}`);
  return {
    claim: required(item.claim || item.text, `证据缺口 ${index + 1}`, 2000),
    needed: optional(item.needed || item.suggestion, `证据缺口 ${index + 1} 所需证据`, 2000),
    source_refs: array(item.source_refs || item.sourceRefs || [], `证据缺口 ${index + 1} 来源`, 20).map((source) => required(source, "证据来源", 500)),
  };
}

function normalizeCounterargument(value, index) {
  const item = typeof value === "string" ? { claim: value } : record(value, `反方 ${index + 1}`);
  return {
    claim: required(item.claim || item.text, `反方 ${index + 1}`, 2000),
    response: optional(item.response, `反方 ${index + 1} 回应`, 2000),
  };
}

export function validateContentConstruction(value) {
  const input = record(value, "内容构造");
  const elements = array(input.elements || [], "内容要素").map(normalizeElement);
  const elementIds = new Set(elements.map((item) => item.id));
  if (elementIds.size !== elements.length) throw new TypeError("内容要素 ID 不能重复");
  return {
    elements,
    relations: array(input.relations || [], "要素关系").map((item, index) => normalizeRelation(item, index, elementIds)),
    entry_options: array(input.entry_options || input.entryOptions || [], "大众入口", 20).map(normalizeEntryOption),
    evidence_gaps: array(input.evidence_gaps || input.evidenceGaps || [], "证据缺口", 30).map(normalizeEvidenceGap),
    counterarguments: array(input.counterarguments || [], "反方", 30).map(normalizeCounterargument),
  };
}

function parseConstruction(value, id) {
  try { return JSON.parse(value); } catch { throw new Error(`内容机会 ${id} 的结构化内容已损坏`); }
}

function agendaDto(row) {
  return row && {
    id: row.id,
    title: row.title,
    audience: row.audience,
    problemSpace: row.problem_space,
    desiredJudgment: row.desired_judgment,
    valueCommitment: row.value_commitment,
    relatedProduct: row.related_product,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function sourceDto(row) {
  return {
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    evidenceText: row.evidence_text,
    observedAt: row.observed_at,
  };
}

function problemDto(row, sources = []) {
  return row && {
    id: row.id,
    statement: row.statement,
    summary: row.summary,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    pattern: row.pattern,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    sources,
  };
}

function opportunityDto(row) {
  return row && {
    id: row.id,
    wikiPageId: row.wiki_page_id,
    audienceProblemId: row.audience_problem_id,
    agendaId: row.agenda_id,
    coreClaim: row.core_claim,
    knowledgeExplanation: row.knowledge_explanation,
    cognitiveGap: row.cognitive_gap,
    dominantAction: row.dominant_action,
    fit: row.fit,
    fitReason: row.fit_reason,
    construction: parseConstruction(row.construction_json, row.id),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export class ContentBridgeDomain {
  constructor({ db, repository, workspaceDomain }) {
    this.db = db;
    this.repository = repository;
    this.workspaceDomain = workspaceDomain;
  }

  createAgenda({ id = createUlid(), title, audience = "", problemSpace = "", desiredJudgment, valueCommitment = "", relatedProduct = "", actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "创建议程");
    const stamp = isoNow(now);
    const agenda = {
      title: required(title, "议程名称", 120),
      audience: optional(audience, "议程受众", 1000),
      problemSpace: optional(problemSpace, "议程问题空间", 2000),
      desiredJudgment: required(desiredJudgment, "希望受众形成的判断", 2000),
      valueCommitment: optional(valueCommitment, "议程价值承诺", 2000),
      relatedProduct: optional(relatedProduct, "议程关联产品", 1000),
    };
    return this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "content_agenda", now });
      this.db.prepare(`INSERT INTO content_agendas(
        id,title,audience,problem_space,desired_judgment,value_commitment,related_product,status,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(id, agenda.title, agenda.audience, agenda.problemSpace, agenda.desiredJudgment, agenda.valueCommitment, agenda.relatedProduct, stamp, stamp);
      this.repository.setEntityText(id, { title: agenda.title, body: agenda.desiredJudgment, now });
      this.workspaceDomain.audit("content_agenda.created", id, {}, now);
      return id;
    });
  }

  updateAgenda(id, { title, audience = "", problemSpace = "", desiredJudgment, valueCommitment = "", relatedProduct = "", actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "更新议程");
    this.workspaceDomain.entity(id, "content_agenda");
    const current = this.db.prepare("SELECT status FROM content_agendas WHERE id = ?").get(id);
    if (current.status === "archived") throw new Error("已归档议程不能直接修改，请先恢复");
    const agenda = {
      title: required(title, "议程名称", 120),
      audience: optional(audience, "议程受众", 1000),
      problemSpace: optional(problemSpace, "议程问题空间", 2000),
      desiredJudgment: required(desiredJudgment, "希望受众形成的判断", 2000),
      valueCommitment: optional(valueCommitment, "议程价值承诺", 2000),
      relatedProduct: optional(relatedProduct, "议程关联产品", 1000),
    };
    const stamp = isoNow(now);
    return this.repository.transaction(() => {
      this.db.prepare(`UPDATE content_agendas SET title=?,audience=?,problem_space=?,desired_judgment=?,value_commitment=?,related_product=?,updated_at=? WHERE id=?`)
        .run(agenda.title, agenda.audience, agenda.problemSpace, agenda.desiredJudgment, agenda.valueCommitment, agenda.relatedProduct, stamp, id);
      this.repository.setEntityText(id, { title: agenda.title, body: agenda.desiredJudgment, now });
      this.workspaceDomain.touch(id, now);
      this.workspaceDomain.audit("content_agenda.updated", id, {}, now);
      return id;
    });
  }

  setAgendaArchived(id, archived, { actor, confirmed = false, now } = {}) {
    return this.#setArchived("content_agendas", "content_agenda", id, archived, { actor, confirmed, now });
  }

  agendas({ includeArchived = false } = {}) {
    return this.db.prepare(`SELECT * FROM content_agendas a JOIN entities e ON e.id=a.id AND e.deleted_at IS NULL
      ${includeArchived ? "" : "WHERE a.status='active'"} ORDER BY a.updated_at DESC, a.id`).all().map(agendaDto);
  }

  agenda(id) {
    const row = this.db.prepare("SELECT a.* FROM content_agendas a JOIN entities e ON e.id=a.id AND e.deleted_at IS NULL WHERE a.id=?").get(id);
    if (!row) throw new Error("议程不存在");
    return agendaDto(row);
  }

  createAudienceProblem({ id = createUlid(), statement, summary = "", sourceKind, sourceRef, pattern = "feedback", sources = [], actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "保存用户问题");
    const normalizedSources = array(sources, "用户问题来源", 50).map((source, index) => {
      const item = record(source, `用户问题来源 ${index + 1}`);
      const kind = required(item.sourceKind || item.source_kind, `用户问题来源 ${index + 1} 类型`, 80);
      if (!SOURCE_KINDS.has(kind)) throw new TypeError(`用户问题来源 ${index + 1} 类型不受支持`);
      return {
        sourceKind: kind,
        sourceId: required(item.sourceId || item.source_id, `用户问题来源 ${index + 1} 标识`, 500),
        evidenceText: required(item.evidenceText || item.evidence_text, `用户问题来源 ${index + 1} 证据`, 8000),
        observedAt: isoNow(item.observedAt || item.observed_at || now),
      };
    });
    if (!normalizedSources.length) throw new Error("用户问题至少需要一个可回溯来源");
    const primaryKind = clean(sourceKind || normalizedSources[0].sourceKind);
    if (!SOURCE_KINDS.has(primaryKind)) throw new TypeError("用户问题主要来源类型不受支持");
    const canonicalPattern = clean(pattern);
    if (!PROBLEM_PATTERNS.has(canonicalPattern)) throw new TypeError("用户问题模式不受支持");
    const problem = {
      statement: required(statement, "用户问题", 500),
      summary: optional(summary, "用户问题说明", 2000),
      sourceKind: primaryKind,
      sourceRef: required(sourceRef || normalizedSources[0].sourceId, "用户问题主要来源", 500),
      pattern: canonicalPattern,
    };
    const stamp = isoNow(now);
    return this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "audience_problem", now });
      this.db.prepare(`INSERT INTO audience_problems(id,statement,summary,source_kind,source_ref,pattern,status,created_at,updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(id, problem.statement, problem.summary, problem.sourceKind, problem.sourceRef, problem.pattern, stamp, stamp);
      const insertSource = this.db.prepare(`INSERT INTO audience_problem_sources(problem_id,source_kind,source_id,evidence_text,observed_at)
        VALUES (?, ?, ?, ?, ?)`);
      for (const source of normalizedSources) insertSource.run(id, source.sourceKind, source.sourceId, source.evidenceText, source.observedAt);
      this.repository.setEntityText(id, { title: problem.statement, body: problem.summary, now });
      this.workspaceDomain.audit("audience_problem.created", id, { sourceCount: normalizedSources.length }, now);
      return id;
    });
  }

  setAudienceProblemArchived(id, archived, { actor, confirmed = false, now } = {}) {
    return this.#setArchived("audience_problems", "audience_problem", id, archived, { actor, confirmed, now });
  }

  audienceProblems({ includeArchived = false } = {}) {
    const rows = this.db.prepare(`SELECT p.* FROM audience_problems p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL
      ${includeArchived ? "" : "WHERE p.status='active'"} ORDER BY p.updated_at DESC, p.id`).all();
    const sourceStatement = this.db.prepare("SELECT * FROM audience_problem_sources WHERE problem_id=? ORDER BY observed_at DESC, source_kind, source_id");
    return rows.map((row) => problemDto(row, sourceStatement.all(row.id).map(sourceDto)));
  }

  audienceProblem(id) {
    const row = this.db.prepare("SELECT p.* FROM audience_problems p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.id=?").get(id);
    if (!row) throw new Error("用户问题不存在");
    return problemDto(row, this.db.prepare("SELECT * FROM audience_problem_sources WHERE problem_id=? ORDER BY observed_at DESC, source_kind, source_id").all(id).map(sourceDto));
  }

  saveOpportunity({ id = createUlid(), wikiPageId, audienceProblemId, agendaId = null, coreClaim, knowledgeExplanation, cognitiveGap, dominantAction, fit, fitReason, construction = {}, actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "保存内容机会");
    const wiki = this.db.prepare(`SELECT w.id FROM wiki_pages w JOIN entities e ON e.id=w.id AND e.deleted_at IS NULL WHERE w.id=?`).get(required(wikiPageId, "Wiki 页面 ID", 500));
    if (!wiki) throw new Error("Wiki 页面不存在");
    const problem = this.db.prepare(`SELECT p.id,p.status FROM audience_problems p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.id=?`).get(required(audienceProblemId, "用户问题 ID", 500));
    if (!problem || problem.status !== "active") throw new Error("用户问题不存在或已归档");
    if (agendaId) {
      const agenda = this.db.prepare(`SELECT a.id,a.status FROM content_agendas a JOIN entities e ON e.id=a.id AND e.deleted_at IS NULL WHERE a.id=?`).get(agendaId);
      if (!agenda || agenda.status !== "active") throw new Error("议程不存在或已归档");
    }
    const canonicalAction = clean(dominantAction);
    if (!DOMINANT_ACTIONS.has(canonicalAction)) throw new TypeError("主导表达动作不受支持");
    const canonicalFit = clean(fit);
    if (!FITS.has(canonicalFit)) throw new TypeError("内容机会匹配度不受支持");
    const normalizedConstruction = validateContentConstruction(construction);
    const opportunity = {
      coreClaim: required(coreClaim, "核心判断", 4000),
      knowledgeExplanation: required(knowledgeExplanation, "知识解释", 8000),
      cognitiveGap: required(cognitiveGap, "认知差", 4000),
      dominantAction: canonicalAction,
      fit: canonicalFit,
      fitReason: required(fitReason, "匹配理由", 4000),
      constructionJson: JSON.stringify(normalizedConstruction),
    };
    const stamp = isoNow(now);
    return this.repository.transaction(() => {
      this.repository.createEntity({ id, type: "content_opportunity", now });
      this.db.prepare(`INSERT INTO content_opportunities(
        id,wiki_page_id,audience_problem_id,agenda_id,core_claim,knowledge_explanation,cognitive_gap,dominant_action,fit,fit_reason,construction_json,status,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(id, wikiPageId, audienceProblemId, agendaId || null, opportunity.coreClaim, opportunity.knowledgeExplanation, opportunity.cognitiveGap, opportunity.dominantAction, opportunity.fit, opportunity.fitReason, opportunity.constructionJson, stamp, stamp);
      this.repository.setEntityText(id, { title: opportunity.coreClaim, body: `${opportunity.knowledgeExplanation}\n${opportunity.cognitiveGap}`, now });
      this.workspaceDomain.audit("content_opportunity.created", id, { wikiPageId, audienceProblemId, agendaId: agendaId || null }, now);
      return id;
    });
  }

  setOpportunityArchived(id, archived, { actor, confirmed = false, now } = {}) {
    return this.#setArchived("content_opportunities", "content_opportunity", id, archived, { actor, confirmed, now });
  }

  opportunities({ includeArchived = false } = {}) {
    return this.db.prepare(`SELECT o.* FROM content_opportunities o JOIN entities e ON e.id=o.id AND e.deleted_at IS NULL
      ${includeArchived ? "" : "WHERE o.status='active'"} ORDER BY o.updated_at DESC, o.id`).all().map(opportunityDto);
  }

  opportunity(id) {
    const row = this.db.prepare("SELECT o.* FROM content_opportunities o JOIN entities e ON e.id=o.id AND e.deleted_at IS NULL WHERE o.id=?").get(id);
    if (!row) throw new Error("内容机会不存在");
    return opportunityDto(row);
  }

  createProjectFromOpportunity(id, { title, briefMarkdown = "", priority = "中", primaryPlatform = "", actor, confirmed = false, now } = {}) {
    requireConfirmedUser({ actor, confirmed }, "建立内容项目");
    const opportunity = this.opportunity(id);
    if (opportunity.status !== "active") throw new Error("已归档内容机会不能建立项目");
    const existing = this.db.prepare("SELECT project_id AS projectId FROM content_project_opportunities WHERE opportunity_id=? AND role='primary'").get(id);
    if (existing) return existing.projectId;
    const problem = this.audienceProblem(opportunity.audienceProblemId);
    return this.repository.transaction(() => {
      const projectId = this.workspaceDomain.createProject({
        title: clean(title) || opportunity.coreClaim,
        briefMarkdown: clean(briefMarkdown) || `用户问题：${problem.statement}\n\n核心判断：${opportunity.coreClaim}`,
        viewpoint: opportunity.coreClaim,
        audience: "",
        primaryPlatform,
        priority,
        confirmed: true,
        actor: "user",
        now,
      });
      this.db.prepare("INSERT INTO content_project_opportunities(project_id,opportunity_id,role,created_at) VALUES (?, ?, 'primary', ?)")
        .run(projectId, id, isoNow(now));
      this.workspaceDomain.audit("content_opportunity.project_created", id, { projectId }, now);
      return projectId;
    });
  }

  projectOpportunity(projectId) {
    const row = this.db.prepare(`SELECT o.* FROM content_project_opportunities link
      JOIN content_opportunities o ON o.id=link.opportunity_id
      JOIN entities e ON e.id=o.id AND e.deleted_at IS NULL
      WHERE link.project_id=? AND link.role='primary'`).get(projectId);
    return opportunityDto(row);
  }

  #setArchived(table, entityType, id, archived, { actor, confirmed, now }) {
    requireConfirmedUser({ actor, confirmed }, archived ? "归档" : "恢复");
    this.workspaceDomain.entity(id, entityType);
    const current = this.db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(id);
    const next = archived ? "archived" : "active";
    if (current.status === next) return next;
    const stamp = isoNow(now);
    return this.repository.transaction(() => {
      this.db.prepare(`UPDATE ${table} SET status=?,archived_at=?,updated_at=? WHERE id=?`)
        .run(next, archived ? stamp : null, stamp, id);
      this.workspaceDomain.touch(id, now);
      this.workspaceDomain.audit(`${entityType}.${archived ? "archived" : "restored"}`, id, {}, now);
      return next;
    });
  }
}

export const CONTENT_BRIDGE_VALUES = Object.freeze({
  sourceKinds: [...SOURCE_KINDS],
  problemPatterns: [...PROBLEM_PATTERNS],
  fits: [...FITS],
  dominantActions: [...DOMINANT_ACTIONS],
  elementTypes: [...ELEMENT_TYPES],
  relationTypes: [...RELATION_TYPES],
});
