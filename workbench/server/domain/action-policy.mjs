import { createUlid } from "../storage/ids.mjs";
import { sha256Json } from "./integrity.mjs";
import { MUTATING_ACTIONS } from "./values.mjs";

const ACTIONS = new Set(MUTATING_ACTIONS);
const isoNow = (now = new Date()) => new Date(now).toISOString();

function json(value) {
  return JSON.stringify(value ?? null);
}

function parse(value, label) {
  try { return JSON.parse(value); } catch { throw new Error(`${label} 的 JSON 已损坏`); }
}

export class ActionPolicy {
  constructor(db) {
    this.db = db;
  }

  currentVersion(targetId) {
    if (!targetId) return "";
    const entityVersion = this.db.prepare("SELECT version AS value FROM entities WHERE id = ? AND deleted_at IS NULL").get(targetId)?.value ?? "";
    const revision = this.db.prepare("SELECT content_sha256 AS value FROM revisions WHERE entity_id = ? ORDER BY revision_no DESC LIMIT 1").get(targetId)?.value || "";
    return revision ? `v${entityVersion}|revision:${revision}` : entityVersion === "" ? "" : `v${entityVersion}`;
  }

  propose({ id = createUlid(), conversationId = null, actionType, targetId = null, expectedVersion, payload = {}, proposedBy = "ai", now } = {}) {
    if (!ACTIONS.has(actionType)) throw new TypeError("候选操作类型不受支持");
    if (!new Set(["ai", "user"]).has(proposedBy)) throw new TypeError("候选操作来源不受支持");
    const stamp = isoNow(now);
    const payloadSha256 = sha256Json(payload);
    this.db.prepare(`
      INSERT INTO action_candidates(
        id, conversation_id, action_type, target_id, expected_version, payload_json,
        payload_sha256, status, proposed_by, proposed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
    `).run(id, conversationId, actionType, targetId, expectedVersion == null ? this.currentVersion(targetId) : String(expectedVersion), json(payload), payloadSha256, proposedBy, stamp);
    return this.get(id);
  }

  get(id) {
    const row = this.db.prepare(`
      SELECT id, conversation_id AS conversationId, action_type AS actionType, target_id AS targetId,
             expected_version AS expectedVersion, payload_json AS payloadJson,
             payload_sha256 AS payloadSha256, status, proposed_by AS proposedBy,
             proposed_at AS proposedAt, confirmed_at AS confirmedAt, applied_at AS appliedAt,
             result_json AS resultJson
      FROM action_candidates WHERE id = ?
    `).get(String(id || ""));
    if (!row) return null;
    return {
      ...row,
      payload: parse(row.payloadJson, `action candidate ${row.id}`),
      result: parse(row.resultJson, `action candidate ${row.id} result`),
      payloadJson: undefined,
      resultJson: undefined,
    };
  }

  confirm(id, { now } = {}) {
    const changes = this.db.prepare(`
      UPDATE action_candidates SET status = 'confirmed', confirmed_at = ?
      WHERE id = ? AND status = 'proposed'
    `).run(isoNow(now), id).changes;
    if (changes !== 1) throw new Error("候选操作不存在或已经处理");
    return this.get(id);
  }

  reject(id) {
    const changes = this.db.prepare("UPDATE action_candidates SET status = 'rejected' WHERE id = ? AND status IN ('proposed', 'confirmed')")
      .run(id).changes;
    if (changes !== 1) throw new Error("候选操作不存在或已经处理");
    return this.get(id);
  }

  authorize({ actor = "user", candidateId = null, actionType, targetId = null, payload = {}, expectedVersion } = {}) {
    if (!ACTIONS.has(actionType)) throw new TypeError("写操作类型不受支持");
    if (actor === "user") return { authorizedBy: "user", candidate: null };
    if (actor !== "ai") throw new TypeError("写操作 actor 只能是 user 或 ai");
    const candidate = this.get(candidateId);
    if (!candidate) throw new Error("AI 写操作必须先由用户确认");
    if (candidate.actionType !== actionType || (candidate.targetId || null) !== (targetId || null)) throw new Error("确认项与实际操作目标不一致");
    const samePayload = candidate.payloadSha256 === sha256Json(payload);
    if (candidate.status === "applied") {
      if (!samePayload) throw new Error("已执行候选与重试内容不一致");
      return { authorizedBy: "confirmed-ai-candidate", candidate, replay: true, result: candidate.result };
    }
    if (candidate.status !== "confirmed") throw new Error("AI 写操作必须先由用户确认");
    const actualVersion = expectedVersion == null ? this.currentVersion(targetId) : String(expectedVersion);
    if (candidate.expectedVersion !== actualVersion || !samePayload) {
      this.db.prepare("UPDATE action_candidates SET status = 'stale' WHERE id = ? AND status = 'confirmed'").run(candidate.id);
      throw new Error("确认后的操作内容或目标版本已变化，需要重新确认");
    }
    return { authorizedBy: "confirmed-ai-candidate", candidate };
  }

  markApplied(candidateId, { result = null, now } = {}) {
    if (!candidateId) return null;
    const changes = this.db.prepare("UPDATE action_candidates SET status = 'applied', applied_at = ?, result_json = ? WHERE id = ? AND status = 'confirmed'")
      .run(isoNow(now), json(result), candidateId).changes;
    if (changes !== 1) throw new Error("确认项未处于可执行状态");
    return this.get(candidateId);
  }
}
