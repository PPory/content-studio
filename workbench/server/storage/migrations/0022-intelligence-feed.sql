CREATE TABLE intel_briefs (
 id TEXT PRIMARY KEY, story_key TEXT NOT NULL UNIQUE,
 run_id TEXT NOT NULL REFERENCES intel_runs(id), data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 version INTEGER NOT NULL DEFAULT 1, read_version INTEGER NOT NULL DEFAULT 0,
 saved INTEGER NOT NULL DEFAULT 0, helpful INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0,
 edition_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE intel_brief_versions (
 brief_id TEXT NOT NULL REFERENCES intel_briefs(id), version INTEGER NOT NULL,
 run_id TEXT NOT NULL REFERENCES intel_runs(id), data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 created_at TEXT NOT NULL, PRIMARY KEY(brief_id,version)
) STRICT;
CREATE TABLE intel_feed_preferences (
 id INTEGER PRIMARY KEY CHECK(id=1), data_json TEXT NOT NULL CHECK(json_valid(data_json)), updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE intel_blocked_sources (host TEXT PRIMARY KEY, created_at TEXT NOT NULL) STRICT;
CREATE TABLE intel_brief_researches (
 brief_id TEXT NOT NULL REFERENCES intel_briefs(id), research_id TEXT NOT NULL REFERENCES researches(id),
 created_at TEXT NOT NULL, PRIMARY KEY(brief_id,research_id)
) STRICT;
CREATE TABLE intel_feed_merges (
 request_key TEXT PRIMARY KEY, research_id TEXT NOT NULL REFERENCES researches(id), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE intel_reports (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)), created_at TEXT NOT NULL
) STRICT;
CREATE INDEX intel_briefs_edition ON intel_briefs(edition_date,updated_at);
