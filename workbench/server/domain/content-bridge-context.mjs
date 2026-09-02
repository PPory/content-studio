const clean = (value) => String(value ?? "").trim();

function required(value, label) {
  const result = clean(value);
  if (!result) throw new TypeError(`${label}不能为空`);
  return result;
}

export function buildContentBridgeContext(workspace, {
  wikiPageId,
  audienceProblemId,
  agendaId = null,
  includeExperiences = false,
} = {}) {
  const wiki = workspace.db.prepare(`SELECT p.id,p.title,p.summary,p.body_markdown AS bodyMarkdown,p.page_type AS pageType,
    p.current_revision AS currentRevision,p.updated_at AS updatedAt
    FROM wiki_pages p JOIN entities e ON e.id=p.id AND e.deleted_at IS NULL WHERE p.id=?`)
    .get(required(wikiPageId, "Wiki 页面 ID"));
  if (!wiki) throw Object.assign(new Error("Wiki 页面不存在"), { status: 404 });
  wiki.sources = workspace.db.prepare(`SELECT source_entity_id AS sourceId,source_quote AS quote,source_locator AS locator,contribution
    FROM wiki_page_sources WHERE page_id=? ORDER BY created_at DESC LIMIT 20`).all(wiki.id);

  const problem = workspace.contentBridge.audienceProblem(required(audienceProblemId, "用户问题 ID"));
  if (problem.status !== "active") throw Object.assign(new Error("用户问题已归档"), { status: 409 });
  const agenda = agendaId ? workspace.contentBridge.agenda(required(agendaId, "议程 ID")) : null;
  if (agenda && agenda.status !== "active") throw Object.assign(new Error("议程已归档"), { status: 409 });

  const experiences = includeExperiences ? workspace.db.prepare(`SELECT m.id,m.title,m.body_markdown AS bodyMarkdown,e.updated_at AS updatedAt
    FROM materials m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    WHERE m.material_type='个人经历' AND length(trim(m.body_markdown))>0
    ORDER BY e.updated_at DESC,m.id DESC LIMIT 12`).all() : [];

  return {
    wiki,
    problem,
    agenda,
    experiences,
    allowedSources: [
      { sourceKind: "wiki_page", sourceId: wiki.id },
      ...wiki.sources.map((item) => ({ sourceKind: "raw", sourceId: item.sourceId })),
      { sourceKind: "audience_problem", sourceId: problem.id },
      ...problem.sources.map((item) => ({ sourceKind: item.sourceKind, sourceId: item.sourceId })),
      ...experiences.map((item) => ({ sourceKind: "material", sourceId: item.id })),
    ],
    freshness: {
      wikiPageId: wiki.id,
      wikiRevision: wiki.currentRevision,
      audienceProblemId: problem.id,
      audienceProblemUpdatedAt: problem.updatedAt,
      agendaId: agenda?.id || null,
      agendaUpdatedAt: agenda?.updatedAt || null,
    },
  };
}

export function assertContentBridgeFreshness(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Preview 版本信息不能为空");
  const same = clean(value.wikiPageId) === expected.wikiPageId
    && Number(value.wikiRevision) === expected.wikiRevision
    && clean(value.audienceProblemId) === expected.audienceProblemId
    && clean(value.audienceProblemUpdatedAt) === expected.audienceProblemUpdatedAt
    && (clean(value.agendaId) || null) === expected.agendaId
    && (clean(value.agendaUpdatedAt) || null) === expected.agendaUpdatedAt;
  if (!same) throw Object.assign(new Error("相关知识、用户问题或议程已更新，请重新预览后再保存"), { status: 409 });
  return { ...expected };
}
