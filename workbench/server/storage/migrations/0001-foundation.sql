CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE workspace_metadata (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE workspace_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (
    length(entity_type) BETWEEN 1 AND 64
    AND entity_type NOT GLOB '*[^a-z0-9_-]*'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE INDEX entities_active_type_idx
  ON entities(entity_type, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE entity_text (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE entity_relations (
  from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (
    length(relation_type) BETWEEN 1 AND 64
    AND relation_type NOT GLOB '*[^a-z0-9_-]*'
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, relation_type),
  CHECK (from_id <> to_id)
) STRICT;

CREATE INDEX entity_relations_to_idx ON entity_relations(to_id, relation_type);

CREATE VIRTUAL TABLE entity_fts USING fts5(
  title,
  body,
  content='entity_text',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER entity_text_ai AFTER INSERT ON entity_text BEGIN
  INSERT INTO entity_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER entity_text_ad AFTER DELETE ON entity_text BEGIN
  INSERT INTO entity_fts(entity_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER entity_text_au AFTER UPDATE ON entity_text BEGIN
  INSERT INTO entity_fts(entity_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO entity_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image', 'book', 'attachment', 'import')),
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE INDEX assets_active_type_idx
  ON assets(asset_type, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  manifest_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE import_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL DEFAULT '',
  target_id TEXT,
  source_sha256 TEXT,
  target_sha256 TEXT,
  result TEXT NOT NULL CHECK (result IN ('pending', 'imported', 'deduplicated', 'skipped', 'conflict', 'failed')),
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, source_id)
) STRICT;

CREATE INDEX import_items_batch_result_idx ON import_items(batch_id, result);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_id TEXT,
  batch_id TEXT REFERENCES import_batches(id) ON DELETE SET NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC);
