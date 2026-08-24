import { first, run, now } from "./db.js";

const FINAL = new Set(["done", "failed", "cancelled"]);
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const jsonText = (value, max = 500_000) => JSON.stringify(value ?? {}).slice(0, max);

function mapTask(row) {
  if (!row) return null;
  let result = null;
  try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch {}
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    scopeId: row.scope_id,
    documentId: row.document_id,
    documentVersion: row.document_version,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    harnessSessionId: row.harness_session_id,
    stage: row.stage,
    stageLabel: row.stage_label,
    percent: row.percent,
    result,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export async function getAgentTask(env, id) {
  return mapTask(await first(env, "SELECT * FROM agent_tasks WHERE id = ?", clean(id, 180)));
}

export async function claimAgentTask(env, input = {}) {
  const id = clean(input.id, 180);
  const idempotencyKey = clean(input.idempotencyKey, 240);
  const kind = clean(input.kind, 80);
  const owner = clean(input.leaseOwner, 180);
  if (!id || !idempotencyKey || !kind || !owner) throw Object.assign(new Error("任务 id、幂等键、类型和租约持有者不能为空"), { status: 400 });
  const ts = now();
  const leaseSeconds = Math.max(30, Math.min(300, Number(input.leaseSeconds) || 90));
  const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts) || 3));
  await run(env, `INSERT OR IGNORE INTO agent_tasks
    (id,idempotency_key,kind,scope_id,document_id,document_version,status,attempt,max_attempts,lease_owner,lease_expires_at,heartbeat_at,harness_session_id,stage,stage_label,percent,payload_json,result_json,error,created_at,updated_at,finished_at)
    VALUES (?,?,?,?,?,?,'queued',0,?,'',0,0,?,'queued','准备专家任务',2,?,'','',?,?,0)`,
    id, idempotencyKey, kind, clean(input.scopeId, 180), clean(input.documentId, 180), clean(input.documentVersion, 180),
    maxAttempts, clean(input.harnessSessionId, 180), jsonText(input.payload), ts, ts);
  const row = await first(env, "SELECT * FROM agent_tasks WHERE idempotency_key = ?", idempotencyKey);
  if (!row) throw new Error("任务写入后无法读取");
  if (FINAL.has(row.status)) return { claimed: false, task: mapTask(row) };
  await run(env, `UPDATE agent_tasks SET
      status='running', attempt=attempt+1, lease_owner=?, lease_expires_at=?, heartbeat_at=?,
      harness_session_id=?, stage='running', stage_label='专家任务已领取', updated_at=?, error=''
    WHERE id=? AND attempt < max_attempts
      AND (status='queued' OR status='failed' OR (status='running' AND lease_expires_at < ?))`,
    owner, ts + leaseSeconds, ts, clean(input.harnessSessionId, 180), ts, row.id, ts);
  const claimed = await first(env, "SELECT * FROM agent_tasks WHERE id = ?", row.id);
  return { claimed: claimed?.status === "running" && claimed?.lease_owner === owner, task: mapTask(claimed) };
}

export async function heartbeatAgentTask(env, id, input = {}) {
  const owner = clean(input.leaseOwner, 180);
  const ts = now();
  const leaseSeconds = Math.max(30, Math.min(300, Number(input.leaseSeconds) || 90));
  await run(env, `UPDATE agent_tasks SET heartbeat_at=?, lease_expires_at=?, stage=?, stage_label=?, percent=?, updated_at=?
    WHERE id=? AND status='running' AND lease_owner=?`, ts, ts + leaseSeconds,
    clean(input.stage, 80) || "running", clean(input.stageLabel, 300), Math.max(0, Math.min(100, Number(input.percent) || 0)), ts,
    clean(id, 180), owner);
  return getAgentTask(env, id);
}

export async function finishAgentTask(env, id, input = {}) {
  const status = clean(input.status, 20);
  if (!FINAL.has(status)) throw Object.assign(new Error("任务终态不合法"), { status: 400 });
  const owner = clean(input.leaseOwner, 180);
  const ts = now();
  await run(env, `UPDATE agent_tasks SET status=?, stage=?, stage_label=?, percent=?, result_json=?, error=?,
      lease_expires_at=0, heartbeat_at=?, updated_at=?, finished_at=?
    WHERE id=? AND status IN ('queued','running','failed') AND (?='' OR lease_owner=?)`,
    status, status, clean(input.stageLabel, 300), status === "done" ? 100 : Math.max(0, Math.min(100, Number(input.percent) || 0)),
    input.result == null ? "" : jsonText(input.result), clean(input.error, 2000), ts, ts, ts, clean(id, 180), owner, owner);
  return getAgentTask(env, id);
}
