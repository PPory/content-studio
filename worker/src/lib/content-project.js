// 内容项目是 topics / drafts / topic_materials / topic_inbox 的只读聚合视图。
//
// 阶段和母版选择必须只依赖已经落库的事实。这个文件不依赖 LLM 或
// Workers 绑定，让最容易“看起来差不多”的业务判定能用 Node 纯逻辑测试钉住。

import { all, first } from "./db.js";
import { DRAFT_STATUS, DRAFT_WORKFLOW, TOPIC_STATUS } from "./values.js";
import { releaseOptions, releasePackage } from "./release-package.js";
import { winningFeedbackPlan } from "./project-review.js";

export const PROJECT_STAGES = Object.freeze([
  "策划中",
  "生成中",
  "写作中",
  "待诊断",
  "待发布",
  "待复盘",
  "已完成",
  "已搁置",
  "需处理",
]);

const REVIEW_DONE = new Set(["样本不足", "普通", "表现突出", "已沉淀"]);
const asText = (value) => String(value || "").trim();
const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);

export const PROJECT_ACTIONS = Object.freeze(["start-writing", "set-primary", "submit-diagnosis", "approve-diagnosis", "return-writing", "abandon"]);

export function nextDraftWorkflow(current, action) {
  const rules = {
    "submit-diagnosis": { from: [DRAFT_WORKFLOW.WRITING], to: DRAFT_WORKFLOW.DIAGNOSIS },
    "approve-diagnosis": { from: [DRAFT_WORKFLOW.DIAGNOSIS], to: DRAFT_WORKFLOW.READY },
    "return-writing": { from: [DRAFT_WORKFLOW.DIAGNOSIS, DRAFT_WORKFLOW.READY, DRAFT_WORKFLOW.ABANDONED], to: DRAFT_WORKFLOW.WRITING },
    abandon: { from: [DRAFT_WORKFLOW.WRITING, DRAFT_WORKFLOW.DIAGNOSIS, DRAFT_WORKFLOW.READY], to: DRAFT_WORKFLOW.ABANDONED },
  };
  const rule = rules[action];
  if (!rule) throw new Error("action 不合法");
  if (!rule.from.includes(current)) throw new Error(`当前是“${current}”，不能执行这个动作`);
  return rule.to;
}

function newestFirst(a, b) {
  return (Number(b.updated_at) - Number(a.updated_at)) || String(b.id).localeCompare(String(a.id));
}

/**
 * 母版只有三条允许的确定路径：单稿；多稿中唯一匹配主平台；人工确认。
 * 第三条目前没有 schema 字段可记录，所以本阶段遇到歧义必须阻塞，不按新旧、
 * 状态、正文长度或标题猜。
 */
export function chooseMasterDraft(topic, draftRows = []) {
  const drafts = [...draftRows].sort(newestFirst);
  if (!drafts.length) return { master: null, variants: [], blocker: null };

  const explicitId = asText(topic?.primary_draft_id);
  if (explicitId) {
    const explicit = drafts.find((draft) => draft.id === explicitId);
    if (!explicit) return { master: null, variants: drafts, blocker: "已记录的母版不在这个项目中" };
    return { master: explicit, variants: drafts.filter((draft) => draft.id !== explicit.id), blocker: null };
  }
  if (drafts.length === 1) return { master: drafts[0], variants: [], blocker: null };

  const primaryPlatform = asText(topic?.platform);
  const matches = primaryPlatform ? drafts.filter((draft) => draft.platform === primaryPlatform) : [];
  if (matches.length === 1) {
    return { master: matches[0], variants: drafts.filter((draft) => draft.id !== matches[0].id), blocker: null };
  }

  return { master: null, variants: drafts, blocker: "需确认母版" };
}

function publicationRecord(draft) {
  return {
    draftId: draft.id,
    title: draft.headline,
    platform: draft.platform,
    url: asText(draft.published_url),
    publishedAt: asText(draft.published_at) || null,
    complete: draft.status === DRAFT_STATUS.PUBLISHED
      && !!asText(draft.published_url)
      && !!asText(draft.published_at),
  };
}

function publicationFrom(drafts) {
  const records = drafts
    .filter((draft) => draft.status === DRAFT_STATUS.PUBLISHED || draft.published_url || draft.published_at)
    .map((draft) => ({ ...publicationRecord(draft), _updatedAt: Number(draft.updated_at) || 0 }))
    .sort((a, b) => b._updatedAt - a._updatedAt)
    .map(({ _updatedAt, ...record }) => record);
  const latest = records.find((record) => record.complete) || records[0] || null;
  return {
    status: records.some((record) => record.complete) ? "已发布" : records.length ? "记录不完整" : "未发布",
    latest,
    records,
  };
}

function reviewFrom(drafts, publication, topic = null, materials = []) {
  if (publication.status !== "已发布") {
    return { status: "未开始", basis: "", conclusion: "", nextExperiment: "", metrics: null, draftId: null, reviewedAt: null, feedbackCandidates: [], storyCandidateIds: [] };
  }
  const publishedId = publication.latest?.draftId;
  const draft = drafts.find((item) => item.id === publishedId);
  const metrics = draft ? {
    views: draft.views ?? null,
    likes: draft.likes ?? null,
    comments: draft.comments ?? null,
    collects: draft.collects ?? null,
    shares: draft.shares ?? null,
  } : null;
  const feedback = winningFeedbackPlan({ draft, topic, materials, basis: draft?.performance_summary });
  return {
    status: draft?.feedback_status || "未评估",
    basis: asText(draft?.performance_summary),
    conclusion: asText(draft?.review_conclusion),
    nextExperiment: asText(draft?.next_experiment),
    metrics,
    draftId: draft?.id || null,
    reviewedAt: asText(draft?.reviewed_at) || null,
    feedbackCandidates: feedback.candidates,
    storyCandidateIds: feedback.storyIds,
  };
}

/** 旧数据没有 workflow_status 时保守回落到写作中，不让历史稿跳过诊断门槛。 */
const workflowOf = (draft) => asText(draft?.workflow_status)
  || (draft?.status === DRAFT_STATUS.PUBLISHED ? DRAFT_WORKFLOW.PUBLISHED : DRAFT_WORKFLOW.WRITING);

export function deriveProjectStage({ topic = null, drafts = [], materials = [], master = null, masterBlocker = null } = {}) {
  const blockers = [];
  const publication = publicationFrom(drafts);
  const review = reviewFrom(drafts, publication, topic, materials);

  if (masterBlocker) blockers.push(masterBlocker);

  for (const record of publication.records) {
    if (!record.complete) {
      if (!record.url) blockers.push(`稿件“${record.title || record.draftId}”缺少发布链接`);
      if (!record.publishedAt) blockers.push(`稿件“${record.title || record.draftId}”缺少发布时间`);
      if (record.url && record.publishedAt) blockers.push(`稿件“${record.title || record.draftId}”有发布信息，但状态不是已发布`);
    }
  }

  if (!drafts.length && [TOPIC_STATUS.DRAFTED, TOPIC_STATUS.PUBLISHED].includes(topic?.status)) {
    blockers.push("选题状态显示已有稿件，但没有找到关联稿件");
  }
  if (topic?.status === TOPIC_STATUS.PUBLISHED && publication.status !== "已发布") {
    blockers.push("选题状态显示已发布，但缺少完整的发布记录");
  }
  if (topic && topic.status !== TOPIC_STATUS.PUBLISHED && publication.status === "已发布") {
    blockers.push("已有完整发布记录，但选题状态不是已发布");
  }

  if (blockers.length) {
    return {
      stage: "需处理",
      stageReason: blockers[0],
      nextAction: masterBlocker ? "确认母版" : topic?.status === TOPIC_STATUS.PARKED ? "检查搁置项目" : "修复项目关系",
      blockers: [...new Set(blockers)],
      publication,
      review,
    };
  }

  if (topic?.status === TOPIC_STATUS.PARKED || (drafts.length && drafts.every((draft) => workflowOf(draft) === DRAFT_WORKFLOW.ABANDONED))) {
    return {
      stage: "已搁置",
      stageReason: "项目已停止推进，内容和关系仍完整保留",
      nextAction: "恢复写作",
      blockers: [], publication, review,
    };
  }

  if (!drafts.length && topic?.status === TOPIC_STATUS.WRITING) {
    return {
      stage: "生成中",
      stageReason: "选题已进入撰写中，关联稿件尚未生成",
      nextAction: "等待初稿",
      blockers: [], publication, review,
    };
  }

  if (publication.status === "已发布") {
    const reviewed = REVIEW_DONE.has(review.status) && !!review.conclusion && !!review.nextExperiment;
    return reviewed ? {
      stage: "已完成",
      stageReason: "已有完整发布记录、表现判断和复盘结论",
      nextAction: "查看复盘",
      blockers: [], publication, review,
    } : {
      stage: "待复盘",
      stageReason: review.status === "未评估" ? "内容已发布，尚未进行表现判断" : "已有表现依据，还需留下判断和下一步",
      nextAction: review.status === "未评估" ? "开始复盘" : "完成复盘",
      blockers: [!review.conclusion ? "缺少复盘判断" : null, !review.nextExperiment ? "缺少下一篇实验" : null].filter(Boolean),
      publication, review,
    };
  }

  if (drafts.length) {
    const workflow = workflowOf(master || drafts[0]);
    if (workflow === DRAFT_WORKFLOW.DIAGNOSIS) {
      return {
        stage: "待诊断",
        stageReason: "主稿已经完成，等待发布前诊断",
        nextAction: "开始诊断",
        blockers: [], publication, review,
      };
    }
    if (workflow === DRAFT_WORKFLOW.READY) {
      return {
        stage: "待发布",
        stageReason: "主稿已通过诊断，可以进入排版和发布",
        nextAction: "去排版发布",
        blockers: [], publication, review,
      };
    }
    return {
      stage: "写作中",
      stageReason: "主稿正在编辑，尚未提交诊断",
      nextAction: "继续写作",
      blockers: [], publication, review,
    };
  }

  const planningGaps = [];
  if (topic && !asText(topic.audience)) planningGaps.push("缺少目标读者");
  if (topic && !asText(topic.viewpoint)) planningGaps.push("缺少核心观点");
  return {
    stage: "策划中",
    stageReason: planningGaps.length ? planningGaps.join("；") : "选题已建立，尚未开始写作",
    nextAction: planningGaps.length ? "补全创作简报" : "开始写作",
    blockers: planningGaps,
    publication,
    review,
  };
}

function mapTopic(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    viewpoint: row.viewpoint,
    audience: row.audience,
    notes: row.notes,
    platform: row.platform || "",
    priority: row.priority,
    primaryDraftId: row.primary_draft_id || null,
    updatedAt: iso(row.updated_at),
  };
}

function mapDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.headline,
    summary: row.summary,
    body: row.body ?? null,
    platform: row.platform,
    status: workflowOf(row),
    publicationStatus: row.status,
    parentDraftId: row.parent_draft_id || null,
    release: releasePackage(row),
    updatedAt: iso(row.updated_at),
  };
}

function mapMaterial(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    content: row.content,
    sourceUrl: row.source_url || "",
    verificationStatus: row.verification,
    verificationNote: row.verification_note || "",
    inspirationId: row.inbox_id || null,
    updatedAt: iso(row.updated_at),
  };
}

function mapSource(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.kind,
    status: row.status,
    link: row.link || row.canonical_url || "",
    source: row.source || "",
    content: row.body || row.card_markdown || "",
    updatedAt: iso(row.updated_at),
  };
}

export function buildContentProject({ topic = null, drafts = [], materials = [], sources = [] } = {}) {
  const orderedDrafts = [...drafts].sort(newestFirst);
  const selected = chooseMasterDraft(topic, orderedDrafts);
  const state = deriveProjectStage({ topic, drafts: orderedDrafts, materials, master: selected.master, masterBlocker: selected.blocker });
  const onlyDraft = !topic && orderedDrafts[0];
  const updatedUnix = Math.max(Number(topic?.updated_at) || 0, ...orderedDrafts.map((draft) => Number(draft.updated_at) || 0));

  return {
    id: topic?.id || (onlyDraft ? `draft:${onlyDraft.id}` : null),
    title: topic?.title || onlyDraft?.headline || "未命名内容",
    stage: state.stage,
    stageReason: state.stageReason,
    nextAction: state.nextAction,
    blockers: state.blockers,
    brief: topic ? {
      audience: topic.audience || "",
      viewpoint: topic.viewpoint || "",
      notes: topic.notes || "",
      platform: topic.platform || "",
      priority: topic.priority || "",
    } : null,
    topic: mapTopic(topic),
    masterDraft: mapDraft(selected.master),
    variants: selected.variants.map(mapDraft),
    materials: materials.map(mapMaterial),
    sources: sources.map(mapSource),
    publication: state.publication,
    review: state.review,
    releaseOptions: releaseOptions(),
    updatedAt: iso(updatedUnix),
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function parseCursor(cursor) {
  const match = /^(\d+)\.(.+)$/.exec(String(cursor || ""));
  return match ? { updatedAt: Number(match[1]), id: match[2] } : null;
}

/**
 * 列表固定 4 条查询：topics、drafts 先全量读轻字段以精确算阶段计数，
 * 当页的 materials / sources 再各一条批量查。项目多少都不会变成逐项查询。
 */
export async function listContentProjects(env, { stage = "", cursor = "", pageSize = 100 } = {}) {
  const [topics, draftMeta] = await Promise.all([
    all(env, "SELECT * FROM topics"),
    all(env, `SELECT id, topic_id, headline, summary, NULL AS body, platform, status, workflow_status, parent_draft_id,
      cover_url, cover_text, cover_note, keywords_json, interaction_goal,
      published_url, published_at, views, likes, comments, collects, shares,
      performance_summary, feedback_status, review_conclusion, next_experiment, reviewed_at,
      created_at, updated_at FROM drafts`),
  ]);
  const draftsByTopic = groupBy(draftMeta.filter((draft) => draft.topic_id), "topic_id");
  const candidates = [
    ...topics.map((topic) => buildContentProject({ topic, drafts: draftsByTopic.get(topic.id) || [] })),
    ...draftMeta.filter((draft) => !draft.topic_id).map((draft) => buildContentProject({ drafts: [draft] })),
  ].sort((a, b) => {
    const time = Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
    return time || String(b.id).localeCompare(String(a.id));
  });

  const counts = Object.fromEntries(PROJECT_STAGES.map((name) => [name, 0]));
  for (const project of candidates) counts[project.stage] += 1;
  const filtered = stage ? candidates.filter((project) => project.stage === stage) : candidates;

  const parsedCursor = parseCursor(cursor);
  const afterCursor = parsedCursor ? filtered.filter((project) => {
    const updatedAt = Math.floor(Date.parse(project.updatedAt || 0) / 1000);
    return updatedAt < parsedCursor.updatedAt || (updatedAt === parsedCursor.updatedAt && project.id < parsedCursor.id);
  }) : filtered;
  const size = Math.min(Math.max(Number(pageSize) || 100, 1), 100);
  const selected = afterCursor.slice(0, size);
  const hasMore = afterCursor.length > size;

  const topicIds = selected.map((project) => project.topic?.id).filter(Boolean);
  let materials = [];
  let sources = [];
  if (topicIds.length) {
    const holes = topicIds.map(() => "?").join(",");
    [materials, sources] = await Promise.all([
      all(env, `SELECT tm.topic_id AS project_topic_id, m.*
        FROM topic_materials tm JOIN materials m ON m.id = tm.material_id
        WHERE tm.topic_id IN (${holes}) ORDER BY m.updated_at DESC, m.id DESC`, ...topicIds),
      all(env, `SELECT ti.topic_id AS project_topic_id, i.*
        FROM topic_inbox ti JOIN inbox i ON i.id = ti.inbox_id
        WHERE ti.topic_id IN (${holes}) ORDER BY i.updated_at DESC, i.id DESC`, ...topicIds),
    ]);
  }
  const materialMap = groupBy(materials, "project_topic_id");
  const sourceMap = groupBy(sources, "project_topic_id");
  const projects = selected.map((project) => {
    if (!project.topic) return project;
    const topic = topics.find((row) => row.id === project.topic.id);
    return buildContentProject({
      topic,
      drafts: draftsByTopic.get(topic.id) || [],
      materials: materialMap.get(topic.id) || [],
      sources: sourceMap.get(topic.id) || [],
    });
  });
  const last = selected[selected.length - 1];
  const nextCursor = hasMore && last
    ? `${Math.floor(Date.parse(last.updatedAt || 0) / 1000)}.${last.id}`
    : null;
  return { projects, counts, total: filtered.length, nextCursor };
}

/** 详情最多 4 条查询；孤立稿件只需 1 条。 */
export async function getContentProject(env, projectId) {
  if (String(projectId).startsWith("draft:")) {
    const draft = await first(env, "SELECT * FROM drafts WHERE id = ? AND topic_id IS NULL", String(projectId).slice(6));
    return draft ? buildContentProject({ drafts: [draft] }) : null;
  }

  const topic = await first(env, "SELECT * FROM topics WHERE id = ?", projectId);
  if (!topic) return null;
  const [drafts, materials, sources] = await Promise.all([
    all(env, "SELECT * FROM drafts WHERE topic_id = ? ORDER BY updated_at DESC, id DESC", projectId),
    all(env, `SELECT m.* FROM topic_materials tm JOIN materials m ON m.id = tm.material_id
      WHERE tm.topic_id = ? ORDER BY m.updated_at DESC, m.id DESC`, projectId),
    all(env, `SELECT i.* FROM topic_inbox ti JOIN inbox i ON i.id = ti.inbox_id
      WHERE ti.topic_id = ? ORDER BY i.updated_at DESC, i.id DESC`, projectId),
  ]);
  return buildContentProject({ topic, drafts, materials, sources });
}
