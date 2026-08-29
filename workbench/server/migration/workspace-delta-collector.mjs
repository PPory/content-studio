import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveWorkspacePaths } from "../storage/workspace-paths.mjs";

const parse = (value, label) => {
  try { return JSON.parse(value); } catch { throw new Error(`${label} JSON 已损坏`); }
};
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
const entity = (row) => ({ id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at });

export async function collectWorkspaceDelta({ xenhoHome, tempDir }) {
  const paths = resolveWorkspacePaths({ xenhoHome });
  const backupFile = path.join(tempDir, `workspace-delta-${crypto.randomUUID()}.sqlite`);
  const source = new Database(paths.databaseFile, { readonly: true, fileMustExist: true });
  try { await source.backup(backupFile); } finally { source.close(); }

  const db = new Database(backupFile, { readonly: true, fileMustExist: true });
  const records = {};
  const assets = [];
  const assetFiles = [];
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok" || db.pragma("foreign_key_check").length) {
      throw new Error("本地增量 SQLite 完整性检查失败");
    }
    records.projects = db.prepare(`SELECT p.*, e.version, e.created_at, e.updated_at, e.deleted_at FROM projects p JOIN entities e ON e.id=p.id ORDER BY e.created_at,p.id`).all().map((row) => ({
      ...entity(row), title: row.title, briefMarkdown: row.brief_markdown, viewpoint: row.viewpoint, audience: row.audience,
      primaryPlatform: row.primary_platform, priority: row.priority, status: row.status, seedId: row.seed_id,
    }));
    const draftRows = db.prepare(`SELECT d.*, e.version, e.created_at, e.updated_at, e.deleted_at FROM drafts d JOIN entities e ON e.id=d.id ORDER BY e.created_at,d.id`).all();
    records.drafts = draftRows.map((row) => ({
      ...entity(row), projectId: row.project_id, parentDraftId: null, title: row.title, bodyMarkdown: row.body_markdown,
      platform: row.platform, workflowStatus: row.workflow_status, publicationStatus: row.publication_status,
    }));
    records.draftParents = draftRows.filter((row) => row.parent_draft_id).map((row) => ({ draftId: row.id, parentDraftId: row.parent_draft_id }));
    records.revisions = db.prepare("SELECT * FROM revisions ORDER BY created_at,id").all().map((row) => ({
      id: row.id, entityId: row.entity_id, revisionNo: row.revision_no, title: row.title, bodyMarkdown: row.body_markdown,
      contentSha256: row.content_sha256, authorKind: row.author_kind, reason: row.reason, createdAt: row.created_at,
    }));
    records.projectPrimaryDrafts = db.prepare("SELECT project_id,draft_id FROM project_primary_drafts ORDER BY project_id").all().map((row) => ({ projectId: row.project_id, draftId: row.draft_id }));
    records.workspaceSettings = db.prepare("SELECT * FROM workspace_settings ORDER BY key").all().map((row) => ({ key: row.key, value: parse(row.value_json, `setting ${row.key}`), updatedAt: row.updated_at }));
    records.conversations = db.prepare(`SELECT c.*, e.version, e.created_at, e.updated_at, e.deleted_at FROM ai_conversations c JOIN entities e ON e.id=c.id ORDER BY e.created_at,c.id`).all().map((row) => ({
      ...entity(row), title: row.title, scopeType: row.scope_type, scopeId: row.scope_id, model: row.model,
      record: parse(row.record_json, `conversation ${row.id} record`), permissionMode: row.permission_mode, titleMode: row.title_mode,
      pinnedAt: row.pinned_at, archivedAt: row.archived_at, activeTurn: parse(row.active_turn_json, `conversation ${row.id} active turn`),
      lastTurn: parse(row.last_turn_json, `conversation ${row.id} last turn`), sessionMetadata: parse(row.session_metadata_json, `conversation ${row.id} metadata`),
    }));
    records.messages = db.prepare(`SELECT m.*, e.version, e.updated_at, e.deleted_at FROM ai_messages m JOIN entities e ON e.id=m.id ORDER BY m.conversation_id,m.sequence`).all().map((row) => ({
      id: row.id, version: row.version, conversationId: row.conversation_id, sequence: row.sequence, role: row.role,
      bodyMarkdown: row.body_markdown, metadata: parse(row.metadata_json, `message ${row.id} metadata`), createdAt: row.created_at, updatedAt: row.updated_at,
    }));
    records.conversationAssets = db.prepare("SELECT * FROM conversation_assets ORDER BY conversation_id,asset_id").all().map((row) => ({
      conversationId: row.conversation_id, assetId: row.asset_id, displayName: row.display_name, extractedText: row.extracted_text,
      usedAt: row.used_at, createdAt: row.created_at,
    }));
    records.messageAssets = db.prepare("SELECT message_id,asset_id FROM ai_message_assets ORDER BY message_id,asset_id").all().map((row) => ({ messageId: row.message_id, assetId: row.asset_id }));

    for (const row of db.prepare("SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY created_at,id").all()) {
      const file = path.resolve(paths.workspaceDir, row.relative_path);
      if (!inside(paths.assetsDir, file)) throw new Error(`本地增量资源越界：${row.id}`);
      const bytes = await fs.readFile(file);
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      if (digest !== row.sha256 || bytes.length !== row.byte_size) throw new Error(`本地增量资源哈希或大小不一致：${row.id}`);
      const relative = `assets/local/workspace-delta/${digest}-${path.basename(row.relative_path)}`;
      assets.push({ id: row.id, path: relative, type: row.asset_type, originalName: row.original_name, mimeType: row.mime_type });
      assetFiles.push({ source: "local", path: relative, bytes });
    }

    const unsupported = ["captures", "seeds", "materials", "labels", "entity_labels", "project_materials", "project_sources", "release_packages", "publication_records", "metric_snapshots", "reviews", "external_publication_records", "account_metric_snapshots", "books", "book_documents", "book_marks", "knowledge_items", "action_candidates"];
    const unsupportedCounts = Object.fromEntries(unsupported.map((table) => [table, db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
    const present = Object.entries(unsupportedCounts).filter(([, count]) => count > 0);
    if (present.length) throw new Error(`本地增量出现未支持业务表：${present.map(([table, count]) => `${table}=${count}`).join(", ")}`);
    const recordCount = Object.values(records).reduce((sum, rows) => sum + rows.length, 0);
    const databaseBytes = await fs.readFile(backupFile);
    const databaseSha256 = crypto.createHash("sha256").update(databaseBytes).digest("hex");
    const databaseAssetPath = `assets/local/workspace-delta/${databaseSha256}-workspace.sqlite`;
    assets.push({ id: `local-workspace-delta-${databaseSha256.slice(0, 24)}`, path: databaseAssetPath, type: "import", originalName: "workspace-delta.sqlite", mimeType: "application/vnd.sqlite3" });
    assetFiles.push({ source: "local", path: databaseAssetPath, bytes: databaseBytes });
    return { source: { records, assets, inventory: { databaseSha256, records: recordCount, assets: assets.length, unsupportedCounts, rawDatabaseIncluded: true } }, assetFiles };
  } finally {
    db.close();
    await fs.rm(backupFile, { force: true });
  }
}
