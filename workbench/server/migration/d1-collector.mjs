import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const contentHash = (title, body) => sha(`${String(title || "")}\u0000${String(body || "")}`);
const fromEpoch = (value) => new Date(Math.max(0, Number(value) || 0) * 1000).toISOString();
const stamp = (value, fallback = 0) => {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fromEpoch(Number(value) || fallback);
};

function executeD1Export(db, sql, { skipInsertTables = new Set() } = {}) {
  let statement = "";
  let index = 0;
  for (const line of String(sql).split(/\r?\n/)) {
    statement += `${line}\n`;
    if (!line.trimEnd().endsWith(";")) continue;
    index += 1;
    const insertTable = statement.match(/^INSERT\s+INTO\s+["`]?([^"`\s(]+)/i)?.[1] || "";
    if (skipInsertTables.has(insertTable)) { statement = ""; continue; }
    try { db.exec(statement); }
    catch (error) {
      const table = statement.match(/^(?:INSERT\s+INTO|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+["`]?([^"`\s(]+)/i)?.[1] || "control";
      const digest = crypto.createHash("sha256").update(statement).digest("hex");
      throw new Error(`D1 导出语句 ${index}（${table}，${Buffer.byteLength(statement)} bytes，sha256=${digest}）无法载入（${error.code || "SQLITE_ERROR"}）`);
    }
    statement = "";
  }
  if (statement.trim()) throw new Error("D1 导出末尾存在不完整 SQL 语句");
}
function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function rows(db, name) {
  return tableExists(db, name) ? db.prepare(`SELECT * FROM "${name}"`).all() : [];
}

function inboxKind(value) {
  return { "文章链接": "article", "视频链接": "video", "想法": "thought", "摘录": "excerpt" }[value] || "thought";
}

function captureStatus(row) {
  if (row.capture_origin === "collection") return { pending: "pending", kept: "accepted", archived: "archived" }[row.review_status] || "needs_review";
  return { "待初筛": "pending", "待选题": "accepted", "已选题": "accepted", "存档备用": "archived", "已弃用": "discarded", "初筛失败/需人工": "needs_review" }[row.status] || "needs_review";
}

function captureBody(row) {
  const parts = [];
  if (row.body) parts.push(String(row.body));
  else if (row.selection) parts.push(String(row.selection));
  if (row.card_markdown && row.card_markdown !== row.body) parts.push(String(row.card_markdown));
  return parts.join("\n\n").trim();
}

function captureReaction(row) {
  return [row.verdict, row.save_note].map((item) => String(item || "").trim()).filter(Boolean).join("\n\n");
}

function draftWorkflow(value) {
  if (value === "待诊断") return "写作中";
  return ["写作中", "待发布", "已发布", "已弃用"].includes(value) ? value : "写作中";
}

function parseKeywords(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

export async function collectD1Source({ sqlFile, tempDir, seedRows = null }) {
  const sql = await fs.readFile(sqlFile, "utf8");
  const databaseFile = path.join(tempDir, `d1-export-${crypto.randomUUID()}.sqlite`);
  const db = new Database(databaseFile);
  db.pragma("foreign_keys = OFF");
  try {
    executeD1Export(db, sql, { skipInsertTables: seedRows ? new Set(["seeds"]) : new Set() });
    db.pragma("foreign_keys = ON");
    if (db.pragma("foreign_key_check").length) throw new Error("D1 导出快照外键检查未通过");
    const sourceRows = {
      inbox: rows(db, "inbox"), materials: rows(db, "materials"), tags: rows(db, "tags"),
      materialTags: rows(db, "material_tags"), inboxTags: rows(db, "inbox_tags"), topics: rows(db, "topics"),
      topicMaterials: rows(db, "topic_materials"), topicInbox: rows(db, "topic_inbox"), drafts: rows(db, "drafts"),
      comments: rows(db, "comments"), taskLog: rows(db, "task_log"), settings: rows(db, "settings"),
      agentTasks: rows(db, "agent_tasks"), externalDocuments: rows(db, "external_documents"), seeds: seedRows || rows(db, "seeds"),
    };
    const inboxIds = new Set(sourceRows.inbox.map((item) => item.id));
    const materialIds = new Set(sourceRows.materials.map((item) => item.id));
    const topicIds = new Set(sourceRows.topics.map((item) => item.id));
    const draftIds = new Set(sourceRows.drafts.map((item) => item.id));
    const records = {
      captures: sourceRows.inbox.map((row) => ({
        id: row.id, kind: inboxKind(row.kind), bucket: row.capture_origin === "collection" ? "collection" : "inbox",
        title: row.title, bodyMarkdown: captureBody(row), sourceUrl: row.canonical_url || row.link || "", status: captureStatus(row),
        reaction: captureReaction(row), createdAt: fromEpoch(row.created_at), updatedAt: fromEpoch(row.updated_at),
      })),
      materials: sourceRows.materials.map((row) => ({
        id: row.id, title: row.title, type: row.type, bodyMarkdown: [row.content, row.performance_basis].filter(Boolean).join("\n\n"),
        sourceUrl: row.source_url || "", sourceEntityId: row.inbox_id && inboxIds.has(row.inbox_id) ? row.inbox_id : null,
        verificationStatus: row.verification || "不适用", verificationNote: row.verification_note || "",
        createdAt: fromEpoch(row.created_at), updatedAt: fromEpoch(row.updated_at),
      })),
      labels: sourceRows.tags.map((row) => ({ id: `d1-tag-${row.id}`, name: row.name, createdAt: "1970-01-01T00:00:00.000Z" })),
      entityLabels: [
        ...sourceRows.materialTags.filter((row) => materialIds.has(row.material_id)).map((row) => ({ entityId: row.material_id, labelId: `d1-tag-${row.tag_id}`, createdAt: "1970-01-01T00:00:00.000Z" })),
        ...sourceRows.inboxTags.filter((row) => inboxIds.has(row.inbox_id)).map((row) => ({ entityId: row.inbox_id, labelId: `d1-tag-${row.tag_id}`, createdAt: "1970-01-01T00:00:00.000Z" })),
      ],
      seeds: sourceRows.seeds.map((row) => ({
        id: row.id, title: row.take || row.source_title || "未命名种子", reaction: row.reaction || "",
        sourceEntityId: row.source_kind === "inbox" && inboxIds.has(row.source_id) ? row.source_id : row.source_kind === "material" && materialIds.has(row.source_id) ? row.source_id : null,
        status: { "攒着": "keeping", "写了": "written", "不写了": "dropped" }[row.status] || "keeping",
        createdAt: fromEpoch(row.created_at), updatedAt: fromEpoch(row.updated_at),
      })),
      projects: sourceRows.topics.map((row) => ({
        id: row.id, title: row.title, briefMarkdown: [row.notes, row.draft_note].filter(Boolean).join("\n\n"), viewpoint: row.viewpoint || "",
        audience: row.audience || "", primaryPlatform: row.platform || "", priority: row.priority || "中", status: row.status === "搁置" ? "parked" : "active",
        createdAt: fromEpoch(row.created_at), updatedAt: fromEpoch(row.updated_at),
      })),
      drafts: [], draftParents: [], projectPrimaryDrafts: [], projectMaterials: [], projectSources: [], revisions: [],
      releasePackages: [], publications: [], metricSnapshots: [], reviews: [],
    };

    const orphans = sourceRows.drafts.filter((row) => !row.topic_id || !topicIds.has(row.topic_id));
    const orphanProjectId = orphans.length ? `d1-orphan-project-${sha(orphans.map((item) => item.id).sort().join("\n")).slice(0, 20)}` : "";
    if (orphanProjectId) records.projects.push({ id: orphanProjectId, title: "未归属旧稿件", briefMarkdown: "迁移时为旧系统中没有选题关系的稿件建立。", priority: "中", status: "parked", createdAt: fromEpoch(Math.min(...orphans.map((item) => item.created_at || 0))) });

    for (const row of sourceRows.drafts) {
      const projectId = row.topic_id && topicIds.has(row.topic_id) ? row.topic_id : orphanProjectId;
      const createdAt = fromEpoch(row.created_at);
      const updatedAt = fromEpoch(row.updated_at);
      const workflowStatus = draftWorkflow(row.workflow_status);
      const publicationStatus = row.status === "已发布" || workflowStatus === "已发布" ? "已发布" : "未发布";
      records.drafts.push({ id: row.id, projectId, title: row.headline, bodyMarkdown: row.body || "", platform: row.platform, workflowStatus, publicationStatus, createdAt, updatedAt });
      if (row.parent_draft_id && draftIds.has(row.parent_draft_id)) records.draftParents.push({ draftId: row.id, parentDraftId: row.parent_draft_id });
      const revisionId = `${row.id}:revision:import`;
      const revisionSha = contentHash(row.headline, row.body || "");
      records.revisions.push({ id: revisionId, entityId: row.id, revisionNo: 1, title: row.headline, bodyMarkdown: row.body || "", contentSha256: revisionSha, authorKind: "import", reason: "D1 正式迁移", createdAt: updatedAt });
      if (row.cover_url || row.cover_text || row.cover_note || row.keywords_json !== "[]" || row.interaction_goal || row.summary) {
        records.releasePackages.push({ id: `${row.id}:release:import`, draftId: row.id, summary: row.summary || "", coverUrl: row.cover_url || "", coverText: row.cover_text || "", coverNote: row.cover_note || "", keywords: parseKeywords(row.keywords_json), interactionGoal: row.interaction_goal || "", updatedAt });
      }
      if (row.published_url && row.published_at) {
        const publicationId = `${row.id}:publication:import`;
        records.publications.push({ id: publicationId, draftId: row.id, revisionId, contentSha256: revisionSha, platform: row.platform, title: row.headline, publishedUrl: row.published_url, publishedAt: stamp(row.published_at, row.updated_at), idempotencyKey: `d1-published:${row.id}`, metadata: { source: "d1" }, createdAt: updatedAt });
        if ([row.views, row.likes, row.comments, row.collects, row.shares].some((value) => value != null)) records.metricSnapshots.push({ id: `${row.id}:metrics:import`, publicationId, capturedAt: stamp(row.reviewed_at || row.updated_at, row.updated_at), views: row.views, likes: row.likes, comments: row.comments, collects: row.collects, shares: row.shares, raw: { performanceSummary: row.performance_summary || "" }, createdAt: updatedAt });
        if (row.feedback_status && row.feedback_status !== "未评估") records.reviews.push({ id: `${row.id}:review:import`, publicationId, status: row.feedback_status, basisMarkdown: row.performance_summary || "", conclusionMarkdown: row.review_conclusion || "", nextExperimentMarkdown: row.next_experiment || "", reviewedAt: stamp(row.reviewed_at || row.updated_at, row.updated_at), createdAt: updatedAt });
      }
    }
    for (const row of sourceRows.topics) if (row.primary_draft_id && draftIds.has(row.primary_draft_id)) records.projectPrimaryDrafts.push({ projectId: row.id, draftId: row.primary_draft_id });
    records.projectMaterials = sourceRows.topicMaterials.filter((row) => topicIds.has(row.topic_id) && materialIds.has(row.material_id)).map((row) => ({ projectId: row.topic_id, materialId: row.material_id, relationKind: "reference", createdAt: "1970-01-01T00:00:00.000Z" }));
    records.projectSources = sourceRows.topicInbox.filter((row) => topicIds.has(row.topic_id) && inboxIds.has(row.inbox_id)).map((row) => ({ projectId: row.topic_id, sourceEntityId: row.inbox_id, createdAt: "1970-01-01T00:00:00.000Z" }));

    return {
      records,
      assets: [],
      inventory: { tableCounts: Object.fromEntries(Object.entries(sourceRows).map(([name, items]) => [name, items.length])) },
      skipped: {
        comments: sourceRows.comments.length,
        taskLog: sourceRows.taskLog.length,
        settings: sourceRows.settings.length,
        agentTasks: sourceRows.agentTasks.length,
        publishedWithoutCompleteFact: sourceRows.drafts.filter((row) => (row.status === "已发布" || row.workflow_status === "已发布") && !(row.published_url && row.published_at)).length,
      },
      feishuMappings: sourceRows.externalDocuments.map((row) => ({ ...row })),
    };
  } finally {
    db.close();
    await fs.rm(databaseFile, { force: true });
  }
}
