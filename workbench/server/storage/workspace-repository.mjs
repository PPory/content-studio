import { createUlid } from "./ids.mjs";

const isoNow = (now = new Date()) => new Date(now).toISOString();

function cleanId(value, label = "id") {
  const id = String(value || "").trim();
  if (!id || id.length > 160 || /[\u0000-\u001f]/.test(id)) throw new TypeError(`${label} 无效`);
  return id;
}

function cleanType(value, label = "type") {
  const type = String(value || "").trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(type)) throw new TypeError(`${label} 只能使用小写字母、数字、下划线和连字符`);
  return type;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parse(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} 的 JSON 已损坏`);
  }
}

function ftsQuery(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

export class WorkspaceRepository {
  constructor(db) {
    this.db = db;
  }

  transaction(callback) {
    if (typeof callback !== "function") throw new TypeError("transaction 需要回调函数");
    return this.db.transaction(() => {
      const result = callback(this);
      if (result && typeof result.then === "function") throw new TypeError("SQLite transaction 回调必须是同步函数");
      return result;
    })();
  }

  setMetadata(key, value, { now } = {}) {
    this.db.prepare(`
      INSERT INTO workspace_metadata(key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(cleanId(key, "metadata key"), json(value), isoNow(now));
  }

  getMetadata(key, fallback = null) {
    const row = this.db.prepare("SELECT value_json FROM workspace_metadata WHERE key = ?").get(cleanId(key, "metadata key"));
    return row ? parse(row.value_json, `metadata ${key}`) : fallback;
  }

  setSetting(key, value, { now } = {}) {
    this.db.prepare(`
      INSERT INTO workspace_settings(key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(cleanId(key, "setting key"), json(value), isoNow(now));
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare("SELECT value_json FROM workspace_settings WHERE key = ?").get(cleanId(key, "setting key"));
    return row ? parse(row.value_json, `setting ${key}`) : fallback;
  }

  createEntity({ id = createUlid(), type, now } = {}) {
    const stamp = isoNow(now);
    const entity = { id: cleanId(id), type: cleanType(type, "entity type"), createdAt: stamp, updatedAt: stamp, deletedAt: null };
    this.db.prepare("INSERT INTO entities(id, entity_type, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)")
      .run(entity.id, entity.type, stamp, stamp);
    return entity;
  }

  getEntity(id, { includeDeleted = false } = {}) {
    const row = this.db.prepare(`
      SELECT id, entity_type AS type, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM entities WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}
    `).get(cleanId(id));
    return row || null;
  }

  softDeleteEntity(id, { now } = {}) {
    const stamp = isoNow(now);
    return this.db.prepare("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(stamp, stamp, cleanId(id)).changes === 1;
  }

  restoreEntity(id, { now } = {}) {
    return this.db.prepare("UPDATE entities SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL")
      .run(isoNow(now), cleanId(id)).changes === 1;
  }

  setEntityText(entityId, { title = "", body = "", now } = {}) {
    this.db.prepare(`
      INSERT INTO entity_text(entity_id, title, body, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at
    `).run(cleanId(entityId, "entity id"), String(title), String(body), isoNow(now));
  }

  relate(fromId, toId, relationType, { now } = {}) {
    this.db.prepare(`
      INSERT INTO entity_relations(from_id, to_id, relation_type, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(from_id, to_id, relation_type) DO NOTHING
    `).run(cleanId(fromId, "from id"), cleanId(toId, "to id"), cleanType(relationType, "relation type"), isoNow(now));
  }

  search(query, { limit = 20 } = {}) {
    const term = String(query || "").trim();
    if (!term) return [];
    const take = Math.max(1, Math.min(100, Number(limit) || 20));
    const rows = new Map();
    const match = ftsQuery(term);
    if (match) {
      try {
        for (const row of this.db.prepare(`
          SELECT e.id, e.entity_type AS type, t.title, t.body, bm25(entity_fts) AS score
          FROM entity_fts
          JOIN entity_text t ON t.rowid = entity_fts.rowid
          JOIN entities e ON e.id = t.entity_id
          WHERE entity_fts MATCH ? AND e.deleted_at IS NULL
          ORDER BY score LIMIT ?
        `).all(match, take)) rows.set(row.id, row);
      } catch {
        // FTS 查询字符不合法时仍由下面的字面 LIKE 提供可预测结果。
      }
    }
    const escaped = term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    for (const row of this.db.prepare(`
      SELECT e.id, e.entity_type AS type, t.title, t.body, NULL AS score
      FROM entity_text t JOIN entities e ON e.id = t.entity_id
      WHERE e.deleted_at IS NULL AND (t.title LIKE ? ESCAPE '\\' OR t.body LIKE ? ESCAPE '\\')
      ORDER BY e.updated_at DESC LIMIT ?
    `).all(`%${escaped}%`, `%${escaped}%`, take)) {
      if (!rows.has(row.id)) rows.set(row.id, row);
    }
    return [...rows.values()].slice(0, take);
  }

  createImportBatch({ id = createUlid(), sourceType, sourceLabel = "", manifestSha256 = null, now } = {}) {
    const batch = { id: cleanId(id), sourceType: cleanType(sourceType, "source type"), status: "pending", startedAt: isoNow(now) };
    this.db.prepare(`
      INSERT INTO import_batches(id, source_type, source_label, manifest_sha256, status, started_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(batch.id, batch.sourceType, String(sourceLabel), manifestSha256, batch.startedAt);
    return batch;
  }

  addImportItem({ id = createUlid(), batchId, sourceId = "", targetId = null, sourceSha256 = null, targetSha256 = null, result = "pending", detail = {}, now } = {}) {
    const itemId = cleanId(id);
    this.db.prepare(`
      INSERT INTO import_items(id, batch_id, source_id, target_id, source_sha256, target_sha256, result, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, cleanId(batchId, "batch id"), String(sourceId), targetId ? cleanId(targetId, "target id") : null,
      sourceSha256, targetSha256, result, json(detail), isoNow(now));
    return itemId;
  }

  finishImportBatch(id, { status = "completed", summary = {}, now } = {}) {
    const allowed = new Set(["completed", "failed", "cancelled"]);
    if (!allowed.has(status)) throw new TypeError("导入批次结束状态无效");
    return this.db.prepare("UPDATE import_batches SET status = ?, summary_json = ?, finished_at = ? WHERE id = ?")
      .run(status, json(summary), isoNow(now), cleanId(id)).changes === 1;
  }

  importItems(batchId) {
    return this.db.prepare(`
      SELECT id, source_id AS sourceId, target_id AS targetId, result, detail_json AS detailJson
      FROM import_items WHERE batch_id = ? ORDER BY created_at, id
    `).all(cleanId(batchId, "batch id")).map((row) => ({
      ...row,
      detail: parse(row.detailJson, `import item ${row.id}`),
      detailJson: undefined,
    }));
  }
}
