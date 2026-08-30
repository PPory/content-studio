import { PLATFORMS, PROJECT_STAGES } from "../domain/values.mjs";

const parseJson = (value, fallback) => {
  try { return JSON.parse(String(value ?? "")); } catch { return fallback; }
};

const RELEASE_SPECS = Object.freeze({
  公众号: { coverLabel: "头图", coverRatio: "2.35:1", outputLabel: "公众号排版", coverRecommended: true },
  X: { coverLabel: "配图", coverRatio: "16:9", outputLabel: "复制发布稿", coverRecommended: false },
  小红书: { coverLabel: "首图", coverRatio: "3:4", outputLabel: "复制发布稿", coverRecommended: true },
  视频号: { coverLabel: "封面", coverRatio: "3:4", outputLabel: "复制发布稿", coverRecommended: true },
  YouTube: { coverLabel: "缩略图", coverRatio: "16:9", outputLabel: "复制发布稿", coverRecommended: true },
});

export const releaseOptions = () => PLATFORMS.map((platform) => ({ platform, ...RELEASE_SPECS[platform] }));

function releaseOf(workspace, draft) {
  const row = workspace.db.prepare("SELECT * FROM release_packages WHERE draft_id = ?").get(draft.id);
  const summary = row?.summary || "";
  return {
    summary,
    coverUrl: row?.cover_url || "",
    coverText: row?.cover_text || "",
    coverNote: row?.cover_note || "",
    keywords: parseJson(row?.keywords_json, []),
    interactionGoal: row?.interaction_goal || "",
    spec: { platform: draft.platform, ...(RELEASE_SPECS[draft.platform] || {}) },
    readiness: { complete: Boolean(summary.trim()), missing: summary.trim() ? [] : ["摘要"] },
  };
}

function draftDto(workspace, row) {
  if (!row) return null;
  const release = releaseOf(workspace, row);
  return {
    id: row.id,
    title: row.title,
    summary: release.summary,
    body: row.body_markdown,
    platform: row.platform,
    status: row.workflow_status,
    publicationStatus: row.publication_status,
    parentDraftId: row.parent_draft_id || null,
    release,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function materialDto(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.material_type,
    content: row.body_markdown,
    note: row.body_markdown,
    link: row.source_url || "",
    sourceUrl: row.source_url || "",
    verificationStatus: row.verification_status,
    verificationNote: row.verification_note || "",
    inspirationId: row.source_entity_id || null,
    inspirationIds: row.source_entity_id ? [row.source_entity_id] : [],
    topicIds: [],
    editedAt: row.updated_at,
    updatedAt: row.updated_at,
    tags: [],
  };
}

function reviewDto(workspace, publication) {
  if (!publication) return { status: "未开始", basis: "", conclusion: "", nextExperiment: "", metrics: null, draftId: null, reviewedAt: null, feedbackCandidates: [], storyCandidateIds: [] };
  const review = workspace.db.prepare(`SELECT r.*, e.updated_at FROM reviews r JOIN entities e ON e.id = r.id AND e.deleted_at IS NULL WHERE r.publication_id = ?`).get(publication.id);
  const metrics = workspace.db.prepare("SELECT views, likes, comments, collects, shares FROM metric_snapshots WHERE publication_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1").get(publication.id) || null;
  if (!review) return { status: "未评估", basis: "", conclusion: "", nextExperiment: "", metrics, draftId: publication.draft_id, reviewedAt: null, feedbackCandidates: [], storyCandidateIds: [] };
  const feedbackCandidates = workspace.db.prepare(`SELECT m.material_type AS type, m.title, m.body_markdown AS content, r.basis_markdown AS evidence
    FROM review_materials rm JOIN materials m ON m.id = rm.material_id JOIN reviews r ON r.id = rm.review_id WHERE rm.review_id = ? ORDER BY m.material_type`).all(review.id);
  const storyCandidateIds = workspace.db.prepare("SELECT material_id AS id FROM review_story_materials WHERE review_id = ? ORDER BY material_id").all(review.id).map((item) => item.id);
  return {
    status: review.status,
    basis: review.basis_markdown,
    conclusion: review.conclusion_markdown,
    nextExperiment: review.next_experiment_markdown,
    metrics,
    draftId: publication.draft_id,
    reviewedAt: review.reviewed_at,
    feedbackCandidates,
    storyCandidateIds,
  };
}

function seriesContextForProject(workspace, projectId) {
  const chapter = workspace.db.prepare(`SELECT sc.id AS chapterId, sc.series_id AS seriesId, sc.title AS chapterTitle, sc.position,
    s.title AS seriesTitle
    FROM series_chapters sc
    JOIN content_series s ON s.id = sc.series_id
    JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL
    WHERE sc.project_id = ?`).get(projectId);
  if (!chapter) return null;
  const siblings = workspace.db.prepare(`SELECT sc.id AS chapterId,
    CASE WHEN pe.deleted_at IS NULL THEN sc.project_id ELSE NULL END AS projectId,
    sc.title, sc.position
    FROM series_chapters sc
    LEFT JOIN entities pe ON pe.id = sc.project_id
    WHERE sc.series_id = ? ORDER BY sc.position`)
    .all(chapter.seriesId);
  const index = siblings.findIndex((item) => item.chapterId === chapter.chapterId);
  return {
    id: chapter.seriesId,
    title: chapter.seriesTitle,
    chapterId: chapter.chapterId,
    chapterTitle: chapter.chapterTitle,
    position: chapter.position,
    total: siblings.length,
    previous: index > 0 ? siblings[index - 1] : null,
    next: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null,
  };
}

export function projectDto(workspace, projectId) {
  const project = workspace.db.prepare(`SELECT p.*, e.updated_at FROM projects p JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL WHERE p.id = ?`).get(projectId);
  if (!project) return null;
  const drafts = workspace.db.prepare(`SELECT d.*, e.updated_at, e.version FROM drafts d JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL WHERE d.project_id = ? ORDER BY e.updated_at DESC, d.id`).all(projectId);
  const primaryId = workspace.db.prepare("SELECT draft_id AS id FROM project_primary_drafts WHERE project_id = ?").get(projectId)?.id || (drafts.length === 1 ? drafts[0].id : null);
  const master = drafts.find((draft) => draft.id === primaryId) || null;
  const publications = workspace.db.prepare(`SELECT p.* FROM publication_records p JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL JOIN drafts d ON d.id = p.draft_id WHERE d.project_id = ? ORDER BY p.published_at DESC, p.id DESC`).all(projectId);
  const publicationRecords = publications.map((row) => ({ draftId: row.draft_id, title: row.title, platform: row.platform, url: row.published_url, publishedAt: row.published_at, complete: true }));
  const latest = publicationRecords[0] || null;
  const latestRow = publications[0] || null;
  const materials = workspace.db.prepare(`SELECT m.*, e.updated_at FROM project_materials pm JOIN materials m ON m.id = pm.material_id JOIN entities e ON e.id = m.id AND e.deleted_at IS NULL WHERE pm.project_id = ? ORDER BY e.updated_at DESC`).all(projectId).map(materialDto);
  const seed = project.seed_id ? workspace.db.prepare(`SELECT s.*, e.updated_at FROM seeds s JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL WHERE s.id = ?`).get(project.seed_id) : null;
  const stage = workspace.domain.projectStage(projectId);
  const nextAction = { 策划中: "开始写作", 生成中: "等待候选稿", 写作中: "写完了，去发布", 待发布: "去排版发布", 待复盘: "开始复盘", 已完成: "查看复盘", 已搁置: "恢复写作", 需处理: "检查项目关系" }[stage.stage] || "打开项目";
  return {
    id: project.id,
    title: project.title || "未命名内容",
    stage: stage.stage,
    stageReason: stage.reason,
    nextAction,
    blockers: stage.blockers || [],
    brief: { audience: project.audience, viewpoint: project.viewpoint, notes: project.brief_markdown, platform: project.primary_platform, priority: project.priority },
    topic: { id: project.id, title: project.title, status: project.status, viewpoint: project.viewpoint, audience: project.audience, notes: project.brief_markdown, platform: project.primary_platform, priority: project.priority, primaryDraftId: primaryId, updatedAt: project.updated_at },
    seed: seed ? { id: seed.id, title: seed.title, status: seed.status, reaction: seed.reaction, editedAt: seed.updated_at } : null,
    masterDraft: draftDto(workspace, master),
    variants: drafts.filter((draft) => draft.id !== primaryId).map((draft) => draftDto(workspace, draft)),
    materials,
    sources: [],
    publication: { status: latest ? "已发布" : "未发布", latest, records: publicationRecords },
    review: reviewDto(workspace, latestRow),
    series: seriesContextForProject(workspace, projectId),
    releaseOptions: releaseOptions(),
    updatedAt: project.updated_at,
  };
}

export function seriesDto(workspace, seriesId) {
  const series = workspace.db.prepare(`SELECT s.*, e.updated_at FROM content_series s
    JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL WHERE s.id = ?`).get(seriesId);
  if (!series) return null;
  const rows = workspace.db.prepare("SELECT * FROM series_chapters WHERE series_id = ? ORDER BY position").all(seriesId);
  const chapters = rows.map((row) => {
    const project = row.project_id ? projectDto(workspace, row.project_id) : null;
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      position: row.position,
      projectId: project?.id || null,
      linkedProjectId: row.project_id || null,
      stage: project?.stage || (row.project_id ? "文章在回收站" : "待开始"),
      publicationStatus: project?.publication?.status || "未发布",
      projectTitle: project?.title || "",
      updatedAt: project?.updatedAt || row.updated_at,
    };
  });
  const published = chapters.filter((chapter) => chapter.publicationStatus === "已发布").length;
  const writing = chapters.filter((chapter) => chapter.projectId && chapter.publicationStatus !== "已发布").length;
  const planned = chapters.filter((chapter) => !chapter.linkedProjectId).length;
  const recycled = chapters.filter((chapter) => chapter.linkedProjectId && !chapter.projectId).length;
  return {
    id: series.id,
    title: series.title,
    description: series.description_markdown,
    audience: series.audience,
    outcome: series.outcome,
    status: series.status,
    chapters,
    progress: {
      total: chapters.length,
      planned,
      writing,
      published,
      recycled,
      percent: chapters.length ? Math.round((published / chapters.length) * 100) : 0,
    },
    updatedAt: series.updated_at,
  };
}

export function listSeries(workspace) {
  const ids = workspace.db.prepare(`SELECT s.id FROM content_series s
    JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL
    ORDER BY e.updated_at DESC, s.id DESC`).all();
  const series = ids.map((row) => seriesDto(workspace, row.id)).filter(Boolean);
  return { series, total: series.length, nextCursor: null };
}

export function listProjects(workspace, { stage = "" } = {}) {
  const ids = workspace.db.prepare(`SELECT p.id FROM projects p JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC, p.id DESC`).all();
  const all = ids.map((row) => projectDto(workspace, row.id)).filter(Boolean);
  const counts = Object.fromEntries(PROJECT_STAGES.map((name) => [name, all.filter((item) => item.stage === name).length]));
  const projects = stage ? all.filter((item) => item.stage === stage) : all;
  return { projects, counts, total: projects.length, nextCursor: null };
}

export function listMaterials(workspace, { stage = "", type = "", verification = "", q = "" } = {}) {
  const rows = workspace.db.prepare(`SELECT m.*, e.updated_at FROM materials m JOIN entities e ON e.id = m.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC, m.id DESC`).all();
  const items = rows.map(materialDto).filter((item) => (!type || item.type === type) && (!verification || item.verificationStatus === verification) && (!q || `${item.title}\n${item.note}`.toLowerCase().includes(q.toLowerCase())));
  const usedIds = new Set(workspace.db.prepare("SELECT DISTINCT material_id AS id FROM project_materials").all().map((item) => item.id));
  const mapped = items.map((record) => ({ id: record.id, kind: "material", sourceKey: "materials", stage: usedIds.has(record.id) ? "已使用" : record.verificationStatus === "待核验" ? "需核验" : "可用素材", type: record.type, title: record.title, excerpt: record.note, source: record.sourceUrl ? "网页" : "手动", link: record.sourceUrl, verificationStatus: record.verificationStatus, verificationNote: record.verificationNote, inspirationIds: record.inspirationIds, materialIds: [], topicIds: record.topicIds, draftIds: [], updatedAt: record.updatedAt, record }));
  const counts = { 待处理: 0, 已收纳: 0, 可用素材: 0, 需核验: 0, 已使用: 0, 已归档: 0 };
  for (const item of mapped) counts[item.stage] = (counts[item.stage] || 0) + 1;
  return { items: stage ? mapped.filter((item) => item.stage === stage) : mapped, total: mapped.length, nextCursor: null, counts, facets: { types: [...new Set(items.map((item) => item.type))], verifications: [...new Set(items.map((item) => item.verificationStatus))] } };
}

export function entityPage(workspace, id) {
  const entity = workspace.repository.getEntity(id);
  if (!entity) return null;
  const text = workspace.db.prepare("SELECT title, body, updated_at AS editedAt FROM entity_text WHERE entity_id = ?").get(id) || { title: "", body: "", editedAt: entity.updatedAt };
  return { text: text.body, meta: { id, title: text.title, editedAt: text.editedAt } };
}
