-- 外部正文提供者映射。正文仍由对应 provider 保存；这里只记录身份和同步摘要。
CREATE TABLE IF NOT EXISTS external_documents (
  id             TEXT PRIMARY KEY,
  provider       TEXT NOT NULL CHECK (provider IN ('feishu')),
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('draft')),
  entity_id      TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  external_url   TEXT NOT NULL DEFAULT '',
  container_id   TEXT NOT NULL DEFAULT '',
  content_hash   TEXT NOT NULL DEFAULT '',
  remote_hash    TEXT NOT NULL DEFAULT '',
  last_source    TEXT NOT NULL DEFAULT 'local' CHECK (last_source IN ('local','remote')),
  last_synced_at INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE(provider, entity_type, entity_id),
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_external_documents_entity
  ON external_documents(entity_type, entity_id);
