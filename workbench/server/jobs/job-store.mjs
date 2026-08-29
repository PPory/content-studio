import { createUlid } from "../storage/ids.mjs";
import { sha256Json, stableTaskKey } from "../domain/integrity.mjs";

const isoNow = (now = new Date()) => new Date(now).toISOString();
const json = (value) => JSON.stringify(value ?? null);

function parse(value, label, fallback = null) {
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { throw new Error(`${label} 的 JSON 已损坏`); }
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    status: row.status,
    payload: parse(row.payload_json, `job ${row.id} payload`, {}),
    result: parse(row.result_json, `job ${row.id} result`),
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    dueAt: row.due_at,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export class JobStore {
  constructor(db) {
    this.db = db;
  }

  get(id) {
    return mapJob(this.db.prepare("SELECT * FROM local_jobs WHERE id = ? AND deleted_at IS NULL").get(id));
  }

  enqueue({ id = createUlid(), idempotencyKey, kind, payload = {}, dueAt, maxAttempts = 3, now } = {}) {
    const stamp = isoNow(now);
    const key = String(idempotencyKey || stableTaskKey(kind, payload)).trim();
    if (!String(kind || "").trim() || !key) throw new TypeError("任务类型和幂等键不能为空");
    const attempts = Math.max(1, Math.min(10, Number(maxAttempts) || 3));
    const existing = this.db.prepare("SELECT * FROM local_jobs WHERE idempotency_key = ?").get(key);
    if (existing) {
      if (existing.kind !== kind || sha256Json(parse(existing.payload_json, `job ${existing.id} payload`, {})) !== sha256Json(payload)) {
        throw new Error("同一任务幂等键对应了不同内容");
      }
      return { created: false, job: mapJob(existing) };
    }
    this.db.prepare(`
      INSERT INTO local_jobs(id, idempotency_key, kind, payload_json, max_attempts, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, key, String(kind).trim(), json(payload), attempts, isoNow(dueAt || now), stamp, stamp);
    return { created: true, job: this.get(id) };
  }

  claim({ leaseOwner, leaseSeconds = 90, now } = {}) {
    const owner = String(leaseOwner || "").trim();
    if (!owner) throw new TypeError("领取任务必须提供 leaseOwner");
    const current = new Date(now || Date.now());
    const stamp = current.toISOString();
    const expiresAt = new Date(current.getTime() + Math.max(30, Math.min(300, Number(leaseSeconds) || 90)) * 1000).toISOString();
    return this.db.transaction(() => {
      const exhausted = this.db.prepare("SELECT id, attempt, lease_token FROM local_jobs WHERE status = 'running' AND lease_expires_at < ? AND attempt >= max_attempts").all(stamp);
      for (const job of exhausted) {
        this.db.prepare("UPDATE local_job_runs SET status = 'failed', finished_at = ?, error = 'lease expired after final attempt' WHERE job_id = ? AND attempt = ? AND lease_token = ? AND status = 'running'")
          .run(stamp, job.id, job.attempt, job.lease_token);
        this.db.prepare("UPDATE local_jobs SET status = 'failed', lease_owner = '', lease_token = '', lease_expires_at = NULL, last_error = 'lease expired after final attempt', updated_at = ?, finished_at = ? WHERE id = ? AND status = 'running' AND lease_token = ?")
          .run(stamp, stamp, job.id, job.lease_token);
      }
      const row = this.db.prepare(`
        SELECT * FROM local_jobs
        WHERE deleted_at IS NULL AND attempt < max_attempts AND due_at <= ?
          AND (status IN ('queued', 'retry') OR (status = 'running' AND lease_expires_at < ?))
        ORDER BY due_at, created_at, id LIMIT 1
      `).get(stamp, stamp);
      if (!row) return null;
      if (row.status === "running") {
        this.db.prepare("UPDATE local_job_runs SET status = 'failed', finished_at = ?, error = 'lease expired' WHERE job_id = ? AND attempt = ? AND lease_token = ? AND status = 'running'")
          .run(stamp, row.id, row.attempt, row.lease_token);
      }
      const nextAttempt = row.attempt + 1;
      const leaseToken = createUlid();
      const changed = this.db.prepare(`
        UPDATE local_jobs SET status = 'running', attempt = ?, lease_owner = ?, lease_token = ?, lease_expires_at = ?, updated_at = ?, last_error = ''
        WHERE id = ? AND attempt = ? AND status = ? AND lease_token = ?
      `).run(nextAttempt, owner, leaseToken, expiresAt, stamp, row.id, row.attempt, row.status, row.lease_token).changes;
      if (changed !== 1) return null;
      this.db.prepare("INSERT INTO local_job_runs(id, job_id, attempt, lease_owner, lease_token, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)")
        .run(createUlid(), row.id, nextAttempt, owner, leaseToken, stamp);
      return this.get(row.id);
    })();
  }

  heartbeat(id, { leaseOwner, leaseToken, leaseSeconds = 90, now } = {}) {
    const current = new Date(now || Date.now());
    const stamp = current.toISOString();
    const expiresAt = new Date(current.getTime() + Math.max(30, Math.min(300, Number(leaseSeconds) || 90)) * 1000).toISOString();
    const changes = this.db.prepare("UPDATE local_jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_token = ? AND lease_expires_at >= ?")
      .run(expiresAt, stamp, id, leaseOwner, leaseToken, stamp).changes;
    if (changes !== 1) throw new Error("任务租约不存在或已失效");
    return this.get(id);
  }

  complete(id, { leaseOwner, leaseToken, result = {}, now } = {}) {
    const stamp = isoNow(now);
    return this.db.transaction(() => {
      const job = this.db.prepare("SELECT * FROM local_jobs WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_token = ? AND lease_expires_at >= ?").get(id, leaseOwner, leaseToken, stamp);
      if (!job) throw new Error("只有当前有效租约持有者可以完成任务");
      this.db.prepare("UPDATE local_jobs SET status = 'done', result_json = ?, lease_owner = '', lease_token = '', lease_expires_at = NULL, updated_at = ?, finished_at = ? WHERE id = ? AND lease_token = ?")
        .run(json(result), stamp, stamp, id, leaseToken);
      this.db.prepare("UPDATE local_job_runs SET status = 'done', result_json = ?, finished_at = ? WHERE job_id = ? AND attempt = ? AND lease_token = ? AND status = 'running'")
        .run(json(result), stamp, id, job.attempt, leaseToken);
      return this.get(id);
    })();
  }

  fail(id, { leaseOwner, leaseToken, error, retryDelaySeconds = 60, retry = true, now } = {}) {
    const current = new Date(now || Date.now());
    const stamp = current.toISOString();
    return this.db.transaction(() => {
      const job = this.db.prepare("SELECT * FROM local_jobs WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_token = ? AND lease_expires_at >= ?").get(id, leaseOwner, leaseToken, stamp);
      if (!job) throw new Error("只有当前有效租约持有者可以标记任务失败");
      const shouldRetry = retry !== false && job.attempt < job.max_attempts;
      const dueAt = new Date(current.getTime() + Math.max(0, Number(retryDelaySeconds) || 0) * 1000).toISOString();
      this.db.prepare("UPDATE local_jobs SET status = ?, due_at = ?, lease_owner = '', lease_token = '', lease_expires_at = NULL, last_error = ?, updated_at = ?, finished_at = ? WHERE id = ? AND lease_token = ?")
        .run(shouldRetry ? "retry" : "failed", dueAt, String(error || "").slice(0, 2000), stamp, shouldRetry ? null : stamp, id, leaseToken);
      this.db.prepare("UPDATE local_job_runs SET status = 'failed', error = ?, finished_at = ? WHERE job_id = ? AND attempt = ? AND lease_token = ? AND status = 'running'")
        .run(String(error || "").slice(0, 2000), stamp, id, job.attempt, leaseToken);
      return this.get(id);
    })();
  }
}