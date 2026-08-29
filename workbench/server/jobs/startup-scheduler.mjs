import { stableTaskKey } from "../domain/integrity.mjs";

export const DEFAULT_LOCAL_SCHEDULES = Object.freeze([
  Object.freeze({ key: "pipeline-dispatch", kind: "pipeline.dispatch", intervalSeconds: 300, payload: {} }),
  Object.freeze({ key: "material-synthesis", kind: "materials.synthesize", intervalSeconds: 86_400, payload: {} }),
]);

const isoNow = (now = new Date()) => new Date(now).toISOString();

export function registerDefaultSchedules(db, { schedules = DEFAULT_LOCAL_SCHEDULES, now } = {}) {
  const stamp = isoNow(now);
  const statement = db.prepare(`
    INSERT INTO local_schedules(schedule_key, job_kind, interval_seconds, next_due_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(schedule_key) DO UPDATE SET
      job_kind = excluded.job_kind,
      interval_seconds = excluded.interval_seconds,
      payload_json = excluded.payload_json
  `);
  db.transaction(() => {
    for (const schedule of schedules) statement.run(schedule.key, schedule.kind, schedule.intervalSeconds, stamp, JSON.stringify(schedule.payload || {}));
  })();
}

export function enqueueStartupCatchup(db, jobStore, { now } = {}) {
  const current = new Date(now || Date.now());
  const stamp = current.toISOString();
  const due = db.prepare("SELECT * FROM local_schedules WHERE enabled = 1 AND next_due_at <= ? ORDER BY next_due_at, schedule_key").all(stamp);
  const enqueued = [];
  for (const schedule of due) {
    let payload;
    try { payload = JSON.parse(schedule.payload_json); } catch { throw new Error(`schedule ${schedule.schedule_key} 的 JSON 已损坏`); }
    const dueKey = schedule.next_due_at;
    const result = jobStore.enqueue({
      idempotencyKey: stableTaskKey("schedule", schedule.schedule_key, dueKey),
      kind: schedule.job_kind,
      payload: { ...payload, scheduleKey: schedule.schedule_key, scheduledFor: dueKey },
      dueAt: stamp,
      now: current,
    });
    const nextDue = new Date(current.getTime() + schedule.interval_seconds * 1000).toISOString();
    db.prepare("UPDATE local_schedules SET last_enqueued_at = ?, next_due_at = ? WHERE schedule_key = ? AND next_due_at = ?")
      .run(stamp, nextDue, schedule.schedule_key, dueKey);
    enqueued.push(result);
  }
  return enqueued;
}
