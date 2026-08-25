-- 保留旧会话列以兼容既有任务，新增 Pi Agent SDK 会话标识。
ALTER TABLE agent_tasks ADD COLUMN pi_session_id TEXT NOT NULL DEFAULT '';
