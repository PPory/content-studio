CREATE TABLE intel_profiles (
 id TEXT PRIMARY KEY, config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 next_due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE intel_runs (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES intel_profiles(id),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)), status TEXT NOT NULL,
 stage TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', job_id TEXT,
 attempt INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE intel_sources (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)), created_at TEXT NOT NULL,
 capture_id TEXT REFERENCES captures(id)
) STRICT;
CREATE TABLE intel_run_sources (
 run_id TEXT NOT NULL REFERENCES intel_runs(id), source_id TEXT NOT NULL REFERENCES intel_sources(id),
 PRIMARY KEY(run_id,source_id)
) STRICT;
CREATE TABLE intel_steps (
 run_id TEXT NOT NULL REFERENCES intel_runs(id), provider TEXT NOT NULL, status TEXT NOT NULL,
 state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json)), error TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(run_id,provider)
) STRICT;
CREATE TABLE intel_cards (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES intel_profiles(id),
 fingerprint TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES intel_runs(id),
 data_json TEXT NOT NULL CHECK(json_valid(data_json)), status TEXT NOT NULL DEFAULT 'new',
 research_id TEXT REFERENCES researches(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(profile_id,fingerprint)
) STRICT;
CREATE INDEX intel_runs_recent ON intel_runs(created_at DESC);
CREATE INDEX intel_cards_recent ON intel_cards(updated_at DESC);
