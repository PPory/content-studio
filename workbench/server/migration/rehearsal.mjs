import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openWorkspace } from "../storage/workspace.mjs";
import { loadMigrationSnapshot, MIGRATION_SOURCE_ORDER, migrationValueHash } from "./snapshot.mjs";

const SOURCE_RECORDS = Object.freeze({
  d1: new Set(["captures", "seeds", "materials", "labels", "entityLabels", "projects", "drafts", "draftParents", "projectPrimaryDrafts", "projectMaterials", "projectSources", "revisions", "releasePackages", "publications", "metricSnapshots", "reviews"]),
  local: new Set(["projects", "drafts", "draftParents", "projectPrimaryDrafts", "externalPublications", "accountMetrics", "workspaceSettings", "revisions", "books", "bookDocuments", "bookMarks", "knowledgeItems", "conversations", "conversationAssets", "messages", "messageAssets"]),
  xenho: new Set(["conversations", "conversationAssets", "messages"]),
  obsidian: new Set(["books", "bookDocuments", "bookMarks", "knowledgeItems"]),
  supabase: new Set(),
  feishu: new Set(),
});

const CATEGORY_TABLE = Object.freeze({
  captures: "captures", seeds: "seeds", materials: "materials", labels: "labels", entityLabels: "entity_labels",
  projects: "projects", drafts: "drafts", projectPrimaryDrafts: "project_primary_drafts", projectMaterials: "project_materials",
  projectSources: "project_sources", revisions: "revisions", releasePackages: "release_packages", publications: "publication_records", metricSnapshots: "metric_snapshots", reviews: "reviews",
  externalPublications: "external_publication_records", accountMetrics: "account_metric_snapshots", workspaceSettings: "workspace_settings", books: "books",
  bookDocuments: "book_documents", bookMarks: "book_marks", knowledgeItems: "knowledge_items",
  conversations: "ai_conversations", conversationAssets: "conversation_assets", messages: "ai_messages", messageAssets: "ai_message_assets",
});

const INSERT_ORDER = Object.freeze([
  "captures", "materials", "labels", "seeds", "projects", "drafts", "draftParents", "revisions", "projectPrimaryDrafts",
  "projectMaterials", "projectSources", "entityLabels", "releasePackages", "publications", "metricSnapshots", "reviews", "externalPublications",
  "accountMetrics", "workspaceSettings", "books", "bookDocuments", "bookMarks", "knowledgeItems", "conversations", "conversationAssets", "messages", "messageAssets",
]);

const RELATION_CATEGORIES = new Set(["entityLabels", "draftParents", "projectPrimaryDrafts", "projectMaterials", "projectSources", "conversationAssets", "messageAssets"]);
const BODY_FIELD = Object.freeze({ captures: "bodyMarkdown", materials: "bodyMarkdown", drafts: "bodyMarkdown", revisions: "bodyMarkdown", knowledgeItems: "bodyMarkdown", messages: "bodyMarkdown" });
const ASSET_TYPES = new Set(["image", "book", "attachment", "import"]);

const iso = (value, fallback) => {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) throw new TypeError(`无效日期：${value}`);
  return date.toISOString();
};
const text = (value) => String(value ?? "");
const nullableText = (value) => value == null || value === "" ? null : String(value);
const json = (value) => JSON.stringify(value ?? null);
const hashContent = (title, body) => crypto.createHash("sha256").update(`${text(title)}\u0000${text(body)}`).digest("hex");

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requiredId(value, label = "记录 ID") {
  const id = text(value).trim();
  if (!id || id.length > 160 || /[\u0000-\u001f]/.test(id)) throw new TypeError(`${label} 无效`);
  return id;
}

function entity(workspace, record, type, title = "", body = "", now) {
  const id = requiredId(record.id);
  const createdAt = iso(record.createdAt, now);
  const updatedAt = iso(record.updatedAt, createdAt);
  workspace.repository.createEntity({ id, type, now: new Date(createdAt) });
  workspace.db.prepare("UPDATE entities SET created_at = ?, updated_at = ?, deleted_at = ?, version = ? WHERE id = ?")
    .run(createdAt, updatedAt, record.deletedAt ? iso(record.deletedAt, updatedAt) : null, Math.max(1, Number(record.version) || 1), id);
  workspace.repository.setEntityText(id, { title: text(title), body: text(body), now: new Date(updatedAt) });
  return id;
}

function recordKey(category, record) {
  if (record.id) return requiredId(record.id);
  if (category === "workspaceSettings") return requiredId(record.key, "设置 key");
  if (category === "entityLabels") return `${requiredId(record.entityId)}:${requiredId(record.labelId)}`;
  if (category === "draftParents") return requiredId(record.draftId);
  if (category === "projectPrimaryDrafts") return requiredId(record.projectId);
  if (category === "projectMaterials") return `${requiredId(record.projectId)}:${requiredId(record.materialId)}`;
  if (category === "projectSources") return `${requiredId(record.projectId)}:${requiredId(record.sourceEntityId)}`;
  if (category === "conversationAssets") return `${requiredId(record.conversationId)}:${requiredId(record.assetId)}`;
  throw new TypeError(`${category} 缺少可识别主键`);
}

function insertRecord(workspace, category, record, now, assetIdMap) {
  const db = workspace.db;
  switch (category) {
    case "captures": {
      const id = entity(workspace, record, "capture", record.title, record.bodyMarkdown, now);
      db.prepare("INSERT INTO captures(id,capture_kind,capture_bucket,title,body_markdown,source_url,status,reaction) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, record.kind || "thought", record.bucket || "inbox", text(record.title), text(record.bodyMarkdown), text(record.sourceUrl), record.status || "pending", text(record.reaction));
      return id;
    }
    case "seeds": {
      const id = entity(workspace, record, "seed", record.title, record.reaction, now);
      db.prepare("INSERT INTO seeds(id,title,reaction,source_entity_id,status) VALUES (?,?,?,?,?)")
        .run(id, text(record.title), text(record.reaction), nullableText(record.sourceEntityId), record.status || "keeping");
      return id;
    }
    case "materials": {
      const id = entity(workspace, record, "material", record.title, record.bodyMarkdown, now);
      db.prepare(`INSERT INTO materials(id,title,material_type,body_markdown,source_url,source_entity_id,verification_status,verification_note,verification_method,source_snapshot_sha256,verified_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, text(record.title), record.type || "核心观点", text(record.bodyMarkdown), text(record.sourceUrl), nullableText(record.sourceEntityId), record.verificationStatus || "不适用", text(record.verificationNote), text(record.verificationMethod), nullableText(record.sourceSnapshotSha256), record.verifiedAt ? iso(record.verifiedAt, now) : null);
      return id;
    }
    case "labels": {
      const id = entity(workspace, record, "label", record.name, "", now);
      db.prepare("INSERT INTO labels(id,name,color) VALUES (?,?,?)").run(id, text(record.name), text(record.color));
      return id;
    }
    case "projects": {
      const id = entity(workspace, record, "project", record.title, record.briefMarkdown, now);
      db.prepare("INSERT INTO projects(id,title,brief_markdown,viewpoint,audience,primary_platform,priority,status,seed_id) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, text(record.title), text(record.briefMarkdown), text(record.viewpoint), text(record.audience), text(record.primaryPlatform), record.priority || "中", record.status || "active", nullableText(record.seedId));
      return id;
    }
    case "drafts": {
      const id = entity(workspace, record, "draft", record.title, record.bodyMarkdown, now);
      db.prepare("INSERT INTO drafts(id,project_id,parent_draft_id,title,body_markdown,platform,workflow_status,publication_status) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, requiredId(record.projectId, "项目 ID"), nullableText(record.parentDraftId), text(record.title), text(record.bodyMarkdown), text(record.platform), record.workflowStatus || "写作中", record.publicationStatus || "未发布");
      return id;
    }
    case "revisions": {
      const id = requiredId(record.id);
      const contentSha256 = record.contentSha256 || hashContent(record.title, record.bodyMarkdown);
      if (contentSha256 !== hashContent(record.title, record.bodyMarkdown)) throw new Error(`修订正文哈希不一致：${id}`);
      db.prepare("INSERT INTO revisions(id,entity_id,revision_no,title,body_markdown,content_sha256,author_kind,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, requiredId(record.entityId, "修订实体 ID"), Number(record.revisionNo), text(record.title), text(record.bodyMarkdown), contentSha256, record.authorKind || "import", text(record.reason), iso(record.createdAt, now));
      return id;
    }
    case "draftParents":
      db.prepare("UPDATE drafts SET parent_draft_id = ? WHERE id = ?").run(requiredId(record.parentDraftId), requiredId(record.draftId));
      return requiredId(record.draftId);
    case "projectPrimaryDrafts":
      db.prepare("INSERT INTO project_primary_drafts(project_id,draft_id) VALUES (?,?)").run(requiredId(record.projectId), requiredId(record.draftId));
      return requiredId(record.projectId);
    case "projectMaterials":
      db.prepare("INSERT INTO project_materials(project_id,material_id,relation_kind,created_at) VALUES (?,?,?,?)")
        .run(requiredId(record.projectId), requiredId(record.materialId), record.relationKind || "reference", iso(record.createdAt, now));
      return `${record.projectId}:${record.materialId}`;
    case "projectSources":
      db.prepare("INSERT INTO project_sources(project_id,source_entity_id,created_at) VALUES (?,?,?)")
        .run(requiredId(record.projectId), requiredId(record.sourceEntityId), iso(record.createdAt, now));
      return `${record.projectId}:${record.sourceEntityId}`;
    case "releasePackages": {
      const id = entity(workspace, record, "release_package", record.coverText, record.summary, now);
      db.prepare("INSERT INTO release_packages(id,draft_id,summary,cover_url,cover_text,cover_note,keywords_json,interaction_goal,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, requiredId(record.draftId), text(record.summary), text(record.coverUrl), text(record.coverText), text(record.coverNote), json(record.keywords || []), text(record.interactionGoal), iso(record.updatedAt, now));
      return id;
    }    case "entityLabels":
      db.prepare("INSERT INTO entity_labels(entity_id,label_id,created_at) VALUES (?,?,?)")
        .run(requiredId(record.entityId), requiredId(record.labelId), iso(record.createdAt, now));
      return `${record.entityId}:${record.labelId}`;
    case "publications": {
      const id = entity(workspace, record, "publication", record.title, record.publishedUrl, now);
      db.prepare(`INSERT INTO publication_records(id,draft_id,revision_id,content_sha256,platform,title,published_url,published_at,idempotency_key,metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, requiredId(record.draftId), requiredId(record.revisionId), record.contentSha256, text(record.platform), text(record.title), text(record.publishedUrl), iso(record.publishedAt, now), text(record.idempotencyKey || `migration:${id}`), json(record.metadata || {}));
      return id;
    }
    case "metricSnapshots": {
      const id = entity(workspace, record, "metric_snapshot", "", "", now);
      db.prepare("INSERT INTO metric_snapshots(id,publication_id,captured_at,views,likes,comments,collects,shares,raw_json) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, requiredId(record.publicationId), iso(record.capturedAt, now), record.views ?? null, record.likes ?? null, record.comments ?? null, record.collects ?? null, record.shares ?? null, json(record.raw || {}));
      return id;
    }
    case "reviews": {
      const id = entity(workspace, record, "review", "", record.conclusionMarkdown, now);
      db.prepare("INSERT INTO reviews(id,publication_id,status,basis_markdown,conclusion_markdown,next_experiment_markdown,reviewed_at,settlement_sha256) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, requiredId(record.publicationId), record.status || "样本不足", text(record.basisMarkdown), text(record.conclusionMarkdown), text(record.nextExperimentMarkdown), iso(record.reviewedAt, now), nullableText(record.settlementSha256));
      return id;
    }    case "externalPublications": {
      const id = entity(workspace, record, "external_publication", record.title, record.publishedUrl, now);
      db.prepare("INSERT INTO external_publication_records(id,platform,title,published_url,published_at,views,likes,comments,collects,shares,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, text(record.platform), text(record.title), text(record.publishedUrl), iso(record.publishedAt, now), record.views ?? null, record.likes ?? null, record.comments ?? null, record.collects ?? null, record.shares ?? null, record.source || "import");
      return id;
    }
    case "accountMetrics": {
      const id = entity(workspace, record, "account_metric", `${record.platform || ""} ${record.metricDate || ""}`.trim(), record.note, now);
      db.prepare("INSERT INTO account_metric_snapshots(id,metric_date,platform,followers,views,note) VALUES (?,?,?,?,?,?)")
        .run(id, text(record.metricDate), text(record.platform), record.followers ?? null, record.views ?? null, text(record.note));
      return id;
    }
    case "workspaceSettings":
      workspace.repository.setSetting(requiredId(record.key, "设置 key"), record.value, { now: new Date(iso(record.updatedAt, now)) });
      return requiredId(record.key, "设置 key");
    case "books": {
      const id = entity(workspace, record, "book", record.title, record.author, now);
      db.prepare("INSERT INTO books(id,title,author,reading_status,source_asset_id,metadata_json) VALUES (?,?,?,?,?,?)")
        .run(id, text(record.title), text(record.author), record.readingStatus || "未读", nullableText(assetIdMap.get(record.sourceAssetId) || record.sourceAssetId), json(record.metadata || {}));
      return id;
    }
    case "bookDocuments": {
      const id = entity(workspace, record, "book_document", record.title, record.bodyMarkdown, now);
      db.prepare("INSERT INTO book_documents(id,book_id,title,body_markdown,document_order) VALUES (?,?,?,?,?)")
        .run(id, requiredId(record.bookId), text(record.title), text(record.bodyMarkdown), Number(record.documentOrder));
      return id;
    }
    case "bookMarks": {
      const body = [text(record.quoteText), text(record.noteMarkdown)].filter(Boolean).join("\n\n");
      const id = entity(workspace, record, "book_mark", "", body, now);
      db.prepare("INSERT INTO book_marks(id,book_id,document_id,mark_kind,quote_text,note_markdown,color,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, requiredId(record.bookId), requiredId(record.documentId), record.markKind || "highlight", text(record.quoteText), text(record.noteMarkdown), text(record.color), iso(record.createdAt, now));
      return id;
    }
    case "knowledgeItems": {
      const id = entity(workspace, record, "knowledge_item", record.title, record.bodyMarkdown, now);
      db.prepare("INSERT INTO knowledge_items(id,knowledge_kind,book_id,title,body_markdown,quote_text,source_url,locator) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, record.knowledgeKind || "knowledge_card", nullableText(record.bookId), text(record.title), text(record.bodyMarkdown), text(record.quoteText), text(record.sourceUrl), text(record.locator));
      return id;
    }
    case "conversations": {
      const id = entity(workspace, record, "ai_conversation", record.title, "", now);
      const storedRecord = structuredClone(record.record || {});
      storedRecord.attachments = (storedRecord.attachments || []).map((item) => {
        const assetId = assetIdMap.get(item.assetId) || item.assetId;
        const asset = assetId ? workspace.assets.get(assetId) : null;
        return { ...item, assetId, ...(asset ? { originalPath: workspace.assets.resolveRelative(asset.relativePath) } : {}) };
      });
      db.prepare(`INSERT INTO ai_conversations(id,title,scope_type,scope_id,model,record_json,permission_mode,title_mode,pinned_at,archived_at,active_turn_json,last_turn_json,session_metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, text(record.title), record.scopeType || "global", nullableText(record.scopeId), text(record.model), json(storedRecord), record.permissionMode || "daily", record.titleMode || "auto", record.pinnedAt ? iso(record.pinnedAt, now) : null, record.archivedAt ? iso(record.archivedAt, now) : null, json(record.activeTurn ?? null), json(record.lastTurn ?? null), json(record.sessionMetadata || {}));
      return id;
    }
    case "conversationAssets":
      db.prepare("INSERT INTO conversation_assets(conversation_id,asset_id,display_name,extracted_text,used_at,created_at) VALUES (?,?,?,?,?,?)")
        .run(requiredId(record.conversationId), requiredId(assetIdMap.get(record.assetId) || record.assetId), text(record.displayName), text(record.extractedText), record.usedAt ? iso(record.usedAt, now) : null, iso(record.createdAt, now));
      return `${record.conversationId}:${record.assetId}`;
    case "messages": {
      const id = entity(workspace, record, "ai_message", "", record.bodyMarkdown, now);
      db.prepare("INSERT INTO ai_messages(id,conversation_id,sequence,role,body_markdown,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, requiredId(record.conversationId), Number(record.sequence), record.role || "user", text(record.bodyMarkdown), json(record.metadata || {}), iso(record.createdAt, now));
      return id;
    }    case "messageAssets":
      db.prepare("INSERT INTO ai_message_assets(message_id,asset_id) VALUES (?,?)")
        .run(requiredId(record.messageId), requiredId(assetIdMap.get(record.assetId) || record.assetId));
      return `${record.messageId}:${record.assetId}`;
    default: throw new Error(`迁移记录类型不受支持：${category}`);
  }
}

function sourceCounts(snapshot) {
  const result = {};
  for (const [source, data] of snapshot.sources) {
    result[source] = { assets: Array.isArray(data.assets) ? data.assets.length : 0 };
    for (const [category, rows] of Object.entries(data.records || {})) result[source][category] = Array.isArray(rows) ? rows.length : -1;
    for (const [key, value] of Object.entries(data.skipped || {})) if (Number.isSafeInteger(value)) result[source][`skipped_${key}`] = value;
    for (const [key, value] of Object.entries(data.inventory?.tableCounts || {})) if (Number.isSafeInteger(value)) result[source][`raw_${key}`] = value;
  }
  return result;
}

function feishuConflicts(snapshot) {
  const documents = snapshot.sources.get("feishu")?.checks?.mappedDocuments || [];
  return documents.filter((item) => item.remoteChanged === true && item.remoteHash !== item.localHash).map((item) => ({
    source: "feishu", category: "mappedDocuments", id: text(item.id), reason: item.localChanged ? "local_remote_conflict" : "remote_newer",
    localHash: text(item.localHash), remoteHash: text(item.remoteHash), baseHash: text(item.baseHash),
  }));
}

function countTarget(workspace, category) {
  if (category === "draftParents") return workspace.db.prepare("SELECT COUNT(*) AS count FROM drafts WHERE parent_draft_id IS NOT NULL").get().count;
  return workspace.db.prepare(`SELECT COUNT(*) AS count FROM ${CATEGORY_TABLE[category]}`).get().count;
}

function markdownReport(report) {
  const lines = ["# 本地优先迁移演练对账报告", "", `- 结果：${report.ok ? "通过" : "未通过"}`, `- 快照时间：${report.snapshotCreatedAt}`, `- 演练时间：${report.finishedAt}`, `- 目标：系统临时目录隔离工作区`, "", "## 来源数量", ""];
  for (const source of MIGRATION_SOURCE_ORDER) {
    if (!report.sourceCounts[source]) continue;
    const detail = Object.entries(report.sourceCounts[source]).map(([key, value]) => `${key}=${value}`).join("，");
    lines.push(`- ${source}：${detail}`);
  }
  lines.push("", "## 结果汇总", "", `- 导入：${report.results.imported}`, `- 去重：${report.results.deduplicated}`, `- 跳过：${report.results.skipped}`, `- 冲突：${report.results.conflicts}`, `- 失败：${report.results.failed}`, `- 缺失资源：${report.results.missingAssets}`, "", "## 逐类对账", "");
  for (const item of report.reconciliation) lines.push(`- ${item.category}：预期 ${item.expected}，实际 ${item.actual}，${item.ok ? "一致" : "不一致"}`);
  if (report.issues.length) {
    lines.push("", "## 必须处理的问题", "");
    for (const item of report.issues) lines.push(`- ${item.source}/${item.category}/${item.id || "-"}：${item.reason}`);
  }
  lines.push("", "本报告不授权删除任何飞书、Supabase、D1、Worker 或 Obsidian 资源。", "");
  return lines.join("\n");
}

export async function rehearseMigration({ snapshotDir, targetXenhoHome, reportDir, now = new Date() }) {
  const tempRoot = path.resolve(os.tmpdir());
  const target = path.resolve(String(targetXenhoHome || ""));
  if (!inside(tempRoot, target) || target === tempRoot) throw new Error("迁移演练目标必须是系统临时目录中的独立工作区");
  const snapshot = await loadMigrationSnapshot(snapshotDir);
  const report = {
    format: "xenho-migration-reconciliation", formatVersion: 1, mode: "rehearsal", ok: false,
    snapshotCreatedAt: snapshot.manifest.createdAt, snapshotManifestSha256: snapshot.manifestSha256,
    startedAt: new Date(now).toISOString(), finishedAt: null, sourceCounts: sourceCounts(snapshot),
    results: { imported: 0, deduplicated: 0, skipped: 0, conflicts: 0, failed: 0, missingAssets: 0 },
    contentHashes: [], relationships: [], assets: [], reconciliation: [], issues: [],
  };
  const remoteIssues = feishuConflicts(snapshot);
  for (const [source, data] of snapshot.sources) {
    for (const item of data.missingAssets || []) remoteIssues.push({ source, category: "assets", id: text(item.id), reason: item.reason || "资源缺失" });
  }
  if (remoteIssues.length) {
    report.issues.push(...remoteIssues);
    report.results.conflicts += remoteIssues.filter((item) => item.source === "feishu").length;
    report.results.missingAssets += remoteIssues.filter((item) => item.category === "assets").length;
    report.finishedAt = new Date(now).toISOString();
    await writeReports(reportDir, report);
    return report;
  }

  let workspace;
  const seen = new Map();
  const expected = new Map();
  const assetIdMap = new Map();
  try {
    workspace = await openWorkspace({ xenhoHome: target, now });
    const existing = workspace.db.prepare("SELECT COUNT(*) AS count FROM entities").get().count;
    if (existing !== 0) throw new Error("迁移演练目标不是空工作区");

    for (const source of MIGRATION_SOURCE_ORDER) {
      const data = snapshot.sources.get(source);
      if (!data) continue;
      const unknown = Object.keys(data.records || {}).filter((category) => !SOURCE_RECORDS[source].has(category));
      if (unknown.length) throw new Error(`${source} 快照包含越权记录类型：${unknown.join(", ")}`);
      const batch = workspace.repository.createImportBatch({ sourceType: source, sourceLabel: "local-first-rehearsal", manifestSha256: snapshot.manifestSha256, now });
      workspace.db.prepare("UPDATE import_batches SET status = 'running' WHERE id = ?").run(batch.id);

      for (const asset of data.assets || []) {
        const sourceId = `asset:${requiredId(asset.id)}`;
        if (source === "supabase" && asset.referenced !== true) {
          workspace.repository.addImportItem({ batchId: batch.id, sourceId, result: "skipped", detail: { reason: "unreferenced_supabase_asset" }, now });
          report.results.skipped += 1;
          continue;
        }
        try {
          if (!ASSET_TYPES.has(asset.type)) throw new TypeError("资源类型无效");
          const fileEntry = snapshot.files.get(text(asset.path).replaceAll("\\", "/"));
          if (!fileEntry || fileEntry.kind !== "asset" || fileEntry.source !== source) throw new Error("资源文件未列入对应来源清单");
          const imported = await workspace.assets.importBuffer({ id: asset.id, bytes: fileEntry.bytes, type: asset.type, originalName: asset.originalName, mimeType: asset.mimeType, now });
          const result = imported.deduplicated ? "deduplicated" : "imported";
          assetIdMap.set(asset.id, imported.id);
          workspace.repository.addImportItem({ batchId: batch.id, sourceId, targetId: imported.id, sourceSha256: fileEntry.sha256, targetSha256: imported.sha256, result, detail: { type: asset.type, byteSize: imported.byteSize }, now });
          report.results[result] += 1;
          report.assets.push({ source, id: asset.id, targetId: imported.id, type: asset.type, byteSize: imported.byteSize, sha256: imported.sha256, result });
        } catch (error) {
          workspace.repository.addImportItem({ batchId: batch.id, sourceId, result: "failed", detail: { reason: error.message }, now });
          report.results.failed += 1;
          report.issues.push({ source, category: "assets", id: asset.id, reason: error.message });
        }
      }

      for (const category of INSERT_ORDER) {
        for (const record of data.records?.[category] || []) {
          const key = recordKey(category, record);
          const seenKey = `${category}:${key}`;
          const sourceId = seenKey;
          const sourceHash = migrationValueHash(record);
          const winner = seen.get(seenKey);
          if (winner) {
            const same = winner.hash === sourceHash;
            const result = same ? "deduplicated" : "conflict";
            workspace.repository.addImportItem({ batchId: batch.id, sourceId, targetId: winner.targetId, sourceSha256: sourceHash, targetSha256: winner.hash, result, detail: { winnerSource: winner.source, reason: same ? "same_record" : "higher_priority_source_wins" }, now });
            report.results[same ? "deduplicated" : "conflicts"] += 1;
            if (!same) report.issues.push({ source, category, id: key, reason: `与更高优先级 ${winner.source} 记录冲突` });
            continue;
          }
          try {
            const targetId = workspace.repository.transaction(() => insertRecord(workspace, category, record, now, assetIdMap));
            workspace.repository.addImportItem({ batchId: batch.id, sourceId, targetId: RELATION_CATEGORIES.has(category) ? null : targetId, sourceSha256: sourceHash, targetSha256: sourceHash, result: "imported", detail: { category }, now });
            seen.set(seenKey, { source, hash: sourceHash, targetId: RELATION_CATEGORIES.has(category) ? null : targetId });
            expected.set(category, (expected.get(category) || 0) + 1);
            report.results.imported += 1;
            const bodyField = BODY_FIELD[category];
            if (bodyField) report.contentHashes.push({ source, category, id: key, sha256: hashContent(record.title, record[bodyField]) });
            if (RELATION_CATEGORIES.has(category)) report.relationships.push({ source, category, id: key, sha256: sourceHash });
          } catch (error) {
            workspace.repository.addImportItem({ batchId: batch.id, sourceId, sourceSha256: sourceHash, result: "failed", detail: { category, reason: error.message }, now });
            report.results.failed += 1;
            report.issues.push({ source, category, id: key, reason: error.message });
          }
        }
      }
      const batchItems = workspace.repository.importItems(batch.id);
      workspace.repository.finishImportBatch(batch.id, { status: batchItems.some((item) => item.result === "failed") ? "failed" : "completed", summary: batchItems.reduce((sum, item) => ({ ...sum, [item.result]: (sum[item.result] || 0) + 1 }), {}), now });
    }

    for (const category of INSERT_ORDER) {
      const wanted = expected.get(category) || 0;
      const actual = countTarget(workspace, category);
      report.reconciliation.push({ category, expected: wanted, actual, ok: wanted === actual });
    }
    const integrity = workspace.check();
    if (!integrity.ok) report.issues.push({ source: "target", category: "sqlite", id: "", reason: "integrity_check 或 foreign_key_check 未通过" });
    report.ok = report.results.failed === 0 && report.results.conflicts === 0 && report.results.missingAssets === 0 && report.reconciliation.every((item) => item.ok) && integrity.ok;
    workspace.repository.setMetadata("migration_rehearsal", { manifestSha256: snapshot.manifestSha256, ok: report.ok, finishedAt: new Date(now).toISOString() }, { now });
  } catch (error) {
    report.results.failed += 1;
    report.issues.push({ source: "rehearsal", category: "runtime", id: "", reason: error.message });
  } finally {
    if (workspace?.db?.open) workspace.close();
  }
  report.finishedAt = new Date(now).toISOString();
  await writeReports(reportDir, report);
  return report;
}

async function writeReports(reportDir, report) {
  if (!reportDir) return;
  const root = path.resolve(reportDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "migration-reconciliation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(root, "migration-reconciliation.md"), markdownReport(report), "utf8");
}
