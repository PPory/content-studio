CREATE TABLE external_publication_records (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  published_url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  views INTEGER CHECK (views IS NULL OR views >= 0),
  likes INTEGER CHECK (likes IS NULL OR likes >= 0),
  comments INTEGER CHECK (comments IS NULL OR comments >= 0),
  collects INTEGER CHECK (collects IS NULL OR collects >= 0),
  shares INTEGER CHECK (shares IS NULL OR shares >= 0),
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (platform, published_at, title)
) STRICT;

CREATE UNIQUE INDEX external_publication_url_unique
  ON external_publication_records(platform, published_url)
  WHERE published_url <> '';

CREATE TABLE account_metric_snapshots (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  metric_date TEXT NOT NULL,
  platform TEXT NOT NULL,
  followers INTEGER CHECK (followers IS NULL OR followers >= 0),
  views INTEGER CHECK (views IS NULL OR views >= 0),
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (metric_date, platform)
) STRICT;

CREATE TABLE client_requests (
  request_id TEXT PRIMARY KEY,
  client_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL
) STRICT;

ALTER TABLE captures ADD COLUMN capture_bucket TEXT NOT NULL DEFAULT 'inbox' CHECK (capture_bucket IN ('inbox', 'collection'));

ALTER TABLE ai_conversations ADD COLUMN record_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(record_json));
ALTER TABLE ai_conversations ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE ai_conversations ADD COLUMN title_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE ai_conversations ADD COLUMN pinned_at TEXT;
ALTER TABLE ai_conversations ADD COLUMN archived_at TEXT;
ALTER TABLE ai_conversations ADD COLUMN active_turn_json TEXT NOT NULL DEFAULT 'null' CHECK (json_valid(active_turn_json));
ALTER TABLE ai_conversations ADD COLUMN last_turn_json TEXT NOT NULL DEFAULT 'null' CHECK (json_valid(last_turn_json));
ALTER TABLE ai_conversations ADD COLUMN session_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(session_metadata_json));

CREATE TABLE book_documents (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  document_order INTEGER NOT NULL CHECK (document_order > 0),
  UNIQUE (book_id, document_order)
) STRICT;

CREATE TABLE book_marks (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES book_documents(id) ON DELETE CASCADE,
  mark_kind TEXT NOT NULL CHECK (mark_kind IN ('highlight', 'note')),
  quote_text TEXT NOT NULL DEFAULT '',
  note_markdown TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX book_marks_document_idx ON book_marks(document_id, created_at);
CREATE TABLE conversation_assets (
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL DEFAULT '',
  extracted_text TEXT NOT NULL DEFAULT '',
  used_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, asset_id)
) STRICT;
