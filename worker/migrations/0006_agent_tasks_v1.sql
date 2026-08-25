-- AI Agent 长任务的持久状态。正文和业务状态仍由原表负责；这里只保存执行租约与结果。
CREATE TABLE IF NOT EXISTS agent_tasks (
  id                 TEXT PRIMARY KEY,
  idempotency_key    TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL,
  scope_id           TEXT NOT NULL DEFAULT '',
  document_id        TEXT NOT NULL DEFAULT '',
  document_version   TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','done','failed','cancelled')),
  attempt            INTEGER NOT NULL DEFAULT 0,
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  lease_owner        TEXT NOT NULL DEFAULT '',
  lease_expires_at   INTEGER NOT NULL DEFAULT 0,
  heartbeat_at       INTEGER NOT NULL DEFAULT 0,
  harness_session_id TEXT NOT NULL DEFAULT '',
  stage              TEXT NOT NULL DEFAULT 'queued',
  stage_label        TEXT NOT NULL DEFAULT '',
  percent            INTEGER NOT NULL DEFAULT 0,
  payload_json       TEXT NOT NULL DEFAULT '{}',
  result_json        TEXT NOT NULL DEFAULT '',
  error              TEXT NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  finished_at        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_scope_updated
  ON agent_tasks(scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_lease
  ON agent_tasks(status, lease_expires_at);
