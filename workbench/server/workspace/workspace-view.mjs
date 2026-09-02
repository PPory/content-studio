import { PLATFORMS, PROJECT_STAGES } from "../domain/values.mjs";
// 字数口径只有一处（中文按非空白字符数）。合集目录里的字数在服务端数完再给前端，
// 别在前端对着 body 再数一遍——同一篇会显示两个数。
import { countWords } from "../../src/lib/reading.js";

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

/**
 * 一个项目的主稿。
 *
 * ⚠️ 口径必须和 `projectDto` 一样：先看 `project_primary_drafts`，没有指定
 * 而**恰好只有一篇**稿时那篇就是主稿。合集目录里显示的标题、字数、发布状态
 * 都从这儿出去，另写一套的话同一篇文章在文章列表和合集里会显示两个标题。
 */
function masterDraftRow(workspace, projectId) {
  const primaryId = workspace.db.prepare(`SELECT ppd.draft_id AS id FROM project_primary_drafts ppd
    JOIN entities e ON e.id = ppd.draft_id AND e.deleted_at IS NULL WHERE ppd.project_id = ?`).get(projectId)?.id;
  if (primaryId) {
    return workspace.db.prepare(`SELECT d.* FROM drafts d JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL WHERE d.id = ?`).get(primaryId) || null;
  }
  const drafts = workspace.db.prepare(`SELECT d.* FROM drafts d JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL WHERE d.project_id = ?`).all(projectId);
  return drafts.length === 1 ? drafts[0] : null;
}

/**
 * 这篇文章属于哪些合集。
 *
 * ⚠️ **返回数组，不是单个**。一篇文章可以同时进多个合集（0005 去掉了那条全局
 * UNIQUE）。`previous` / `next` **只在恰好属于一个合集时才给**：属于两个合集时
 * 「上一篇」指哪一条没有答案，给一个就是在猜。
 */
function seriesListForProject(workspace, projectId) {
  const memberships = workspace.db.prepare(`SELECT en.id AS entryId, en.series_id AS seriesId, en.position, s.title AS seriesTitle
    FROM series_entries en
    JOIN content_series s ON s.id = en.series_id
    JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL
    WHERE en.project_id = ?
    ORDER BY e.updated_at DESC, s.id DESC`).all(projectId);
  if (!memberships.length) return [];
  const alone = memberships.length === 1;
  return memberships.map((membership) => {
    const articles = workspace.db.prepare(`SELECT en.id AS entryId, en.project_id AS projectId, p.title
      FROM series_entries en
      JOIN projects p ON p.id = en.project_id
      JOIN entities pe ON pe.id = en.project_id AND pe.deleted_at IS NULL
      WHERE en.series_id = ? AND en.kind = 'article' ORDER BY en.position`).all(membership.seriesId);
    const index = articles.findIndex((item) => item.entryId === membership.entryId);
    return {
      id: membership.seriesId,
      title: membership.seriesTitle,
      entryId: membership.entryId,
      position: index >= 0 ? index + 1 : membership.position,
      total: articles.length,
      previous: alone && index > 0 ? articles[index - 1] : null,
      next: alone && index >= 0 && index < articles.length - 1 ? articles[index + 1] : null,
    };
  });
}

export function projectDto(workspace, projectId) {
  const project = workspace.db.prepare(`SELECT p.*, e.updated_at FROM projects p JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL WHERE p.id = ?`).get(projectId);
  if (!project) return null;
  const drafts = workspace.db.prepare(`SELECT d.*, e.updated_at, e.version FROM drafts d JOIN entities e ON e.id = d.id AND e.deleted_at IS NULL WHERE d.project_id = ? ORDER BY e.updated_at DESC, d.id`).all(projectId);
  const primaryId = workspace.db.prepare("SELECT draft_id AS id FROM project_primary_drafts WHERE project_id = ?").get(projectId)?.id || (drafts.length === 1 ? drafts[0].id : null);
  const master = drafts.find((draft) => draft.id === primaryId) || null;
  const publications = workspace.db.prepare(`SELECT p.* FROM publication_records p JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL JOIN drafts d ON d.id = p.draft_id WHERE d.project_id = ? ORDER BY p.published_at DESC, p.id DESC`).all(projectId);
  // ⚠️ id 是必须的：内容实验拿它去比「假设记录时间 vs 发布时间」，缺了那道闸就形同虚设。
  const publicationRecords = publications.map((row) => ({ id: row.id, draftId: row.draft_id, title: row.title, platform: row.platform, url: row.published_url, publishedAt: row.published_at, complete: true }));
  const latest = publicationRecords[0] || null;
  const latestRow = publications[0] || null;
  const materials = workspace.db.prepare(`SELECT m.*, e.updated_at FROM project_materials pm JOIN materials m ON m.id = pm.material_id JOIN entities e ON e.id = m.id AND e.deleted_at IS NULL WHERE pm.project_id = ? ORDER BY e.updated_at DESC`).all(projectId).map(materialDto);
  const seed = project.seed_id ? workspace.db.prepare(`SELECT s.*, e.updated_at FROM seeds s JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL WHERE s.id = ?`).get(project.seed_id) : null;
  const stage = workspace.domain.projectStage(projectId);
  const nextAction = { 策划中: "开始写作", 生成中: "等待候选稿", 写作中: "写完了，去发布", 待发布: "去排版发布", 待复盘: "开始复盘", 已完成: "查看复盘", 已搁置: "恢复写作", 需处理: "检查项目关系" }[stage.stage] || "打开项目";
  const displayTitle = master?.title || project.title || "未命名内容";
  return {
    id: project.id,
    title: displayTitle,
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
    collections: seriesListForProject(workspace, projectId),
    releaseOptions: releaseOptions(),
    updatedAt: project.updated_at,
  };
}

/**
 * 合集的目录。
 *
 * ⚠️ **一条 entry 不要跑一次 `projectDto`**。旧版就是这么写的，而 `listSeries` 又对
 * 每个合集跑一遍 `seriesDto`——`projectDto` 本身要打七八次库、还会反查合集关系，
 * 于是列一次合集列表变成 N×M 次全量 DTO。这里只取目录真正要显示的几个字段。
 *
 * `kind === 'section'` 是分节行（只有 heading，不是文章）；文章行的标题永远从
 * `projects` / 主稿现取，条目上不存标题。
 */
export function seriesDto(workspace, seriesId) {
  const series = workspace.db.prepare(`SELECT s.*, e.updated_at FROM content_series s
    JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL WHERE s.id = ?`).get(seriesId);
  if (!series) return null;
  const rows = workspace.db.prepare(`SELECT en.*, p.title AS projectTitle, pe.deleted_at AS projectDeletedAt, pe.updated_at AS projectUpdatedAt
    FROM series_entries en
    LEFT JOIN projects p ON p.id = en.project_id
    LEFT JOIN entities pe ON pe.id = en.project_id
    WHERE en.series_id = ? ORDER BY en.position`).all(seriesId);

  let articleNumber = 0;
  const entries = rows.map((row) => {
    if (row.kind === "section") {
      return { id: row.id, kind: "section", position: row.position, heading: row.heading };
    }
    articleNumber += 1;
    // 文章被移入回收站时**不把它踢出合集**：归类关系是用户建立的，恢复文章之后
    // 它应该还在原来的位置上。目录里标成「在回收站」并只留「移出合集」。
    const deleted = Boolean(row.projectDeletedAt);
    const master = deleted ? null : masterDraftRow(workspace, row.project_id);
    return {
      id: row.id,
      kind: "article",
      position: row.position,
      number: articleNumber,
      note: row.note,
      projectId: deleted ? null : row.project_id,
      deleted,
      title: master?.title || row.projectTitle || "未命名内容",
      stage: deleted ? "在回收站" : workspace.domain.projectStage(row.project_id).stage,
      publicationStatus: master?.publication_status === "已发布" ? "已发布" : "未发布",
      words: master ? countWords(master.body_markdown) : 0,
      updatedAt: row.projectUpdatedAt || row.updated_at,
    };
  });

  // ⚠️ 计数**不算回收站里的**，和合集列表卡片上的数保持一致——
  // 页头说 8 篇而列表卡说 7 篇，是同一件事给了两个答案。
  const articles = entries.filter((entry) => entry.kind === "article" && !entry.deleted);
  return {
    id: series.id,
    title: series.title,
    description: series.description_markdown,
    entries,
    progress: {
      total: articles.length,
      published: articles.filter((entry) => entry.publicationStatus === "已发布").length,
      recycled: entries.filter((entry) => entry.kind === "article" && entry.deleted).length,
    },
    updatedAt: series.updated_at,
  };
}

/**
 * 合集列表。
 *
 * 每个合集带 `preview`（前三篇文章标题）——卡片上要能看见里面装了什么，
 * 否则一屏名字看不出该点哪个。⚠️ 这里**不调 `seriesDto`**，理由同上。
 */
export function listSeries(workspace) {
  const rows = workspace.db.prepare(`SELECT s.id, s.title, s.description_markdown AS description, e.updated_at AS updatedAt
    FROM content_series s
    JOIN entities e ON e.id = s.id AND e.deleted_at IS NULL
    ORDER BY e.updated_at DESC, s.id DESC`).all();
  const countOf = workspace.db.prepare(`SELECT COUNT(*) AS value FROM series_entries en
    JOIN entities pe ON pe.id = en.project_id AND pe.deleted_at IS NULL
    WHERE en.series_id = ? AND en.kind = 'article'`);
  // ⚠️ **预览标题要走主稿**，不能直接读 `projects.title`：改标题改的是主稿，
  // `projects.title` 会一直停在「未命名」。卡片上于是显示三行「未命名」——
  // 而预览存在的全部意义就是让你认出这个合集装了什么。
  const previewOf = workspace.db.prepare(`SELECT p.id, p.title FROM series_entries en
    JOIN projects p ON p.id = en.project_id
    JOIN entities pe ON pe.id = en.project_id AND pe.deleted_at IS NULL
    WHERE en.series_id = ? AND en.kind = 'article' ORDER BY en.position LIMIT 3`);
  const publishedOf = workspace.db.prepare(`SELECT COUNT(DISTINCT en.project_id) AS value FROM series_entries en
    JOIN entities pe ON pe.id = en.project_id AND pe.deleted_at IS NULL
    JOIN drafts d ON d.project_id = en.project_id AND d.publication_status = '已发布'
    JOIN entities de ON de.id = d.id AND de.deleted_at IS NULL
    WHERE en.series_id = ?`);
  const series = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    updatedAt: row.updatedAt,
    preview: previewOf.all(row.id).map((item) => masterDraftRow(workspace, item.id)?.title || item.title || "未命名内容"),
    progress: { total: countOf.get(row.id).value, published: publishedOf.get(row.id).value },
  }));
  return { series, total: series.length, nextCursor: null };
}

/**
 * 去掉正文开头那个和标题重复的 H1。
 *
 * 稿子里普遍第一行就是 `# 同名标题`，而通读和导出**自己已经给了一层标题**——
 * 不去掉的话每一篇都会连着出现两遍同一句话。
 * ⚠️ **只去掉字面相同的那一个**：内容不一样的 H1 是作者写的东西，不能替他删。
 */
function stripDuplicateHeading(body, title) {
  const match = /^\s*#\s+(.+?)\s*(?:\n|$)/.exec(body || "");
  if (!match || match[1].trim() !== String(title || "").trim()) return body || "";
  return body.slice(match[0].length).replace(/^\s*\n/, "");
}

/**
 * 通读 / 导出用的整份内容：按目录顺序把分节标题和每篇正文摊平。
 *
 * ⚠️ **没写正文的文章要留在结果里**（`body` 为空），不能静默跳过——
 * 通读的用处之一就是看出「哪一节还是空的」。
 */
export function seriesReadDto(workspace, seriesId) {
  const series = seriesDto(workspace, seriesId);
  if (!series) return null;
  const sections = series.entries.map((entry) => {
    if (entry.kind === "section") return { kind: "section", heading: entry.heading };
    const master = entry.projectId ? masterDraftRow(workspace, entry.projectId) : null;
    return {
      kind: "article",
      projectId: entry.projectId,
      title: entry.title,
      note: entry.note,
      deleted: entry.deleted,
      body: stripDuplicateHeading(master?.body_markdown, master?.title || entry.title),
      words: entry.words,
    };
  });
  return { id: series.id, title: series.title, description: series.description, sections, updatedAt: series.updatedAt };
}

/** 把通读内容拼成一份 Markdown。合集名是 H1，分节是 H2，文章是 H3。 */
export function seriesMarkdown(workspace, seriesId) {
  const read = seriesReadDto(workspace, seriesId);
  if (!read) return null;
  const parts = [`# ${read.title}`];
  if (read.description) parts.push(read.description);
  for (const section of read.sections) {
    if (section.kind === "section") { parts.push(`## ${section.heading}`); continue; }
    parts.push(`### ${section.title}`);
    if (section.note) parts.push(`> ${section.note}`);
    parts.push(section.deleted ? "_这篇文章已移入回收站。_" : section.body.trim() || "_这篇还没有正文。_");
  }
  return { title: read.title, markdown: `${parts.join("\n\n")}\n` };
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
