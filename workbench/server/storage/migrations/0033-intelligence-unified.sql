CREATE TABLE IF NOT EXISTS intel_unified_sources (
 source_id TEXT PRIMARY KEY REFERENCES intel_sources(id),
 content_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 brief_id TEXT REFERENCES intel_briefs(id),
 last_error TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intel_unified_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS intel_unified_sources_status ON intel_unified_sources(status,updated_at);
