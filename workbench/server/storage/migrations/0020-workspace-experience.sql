CREATE TABLE workspace_activity (
 entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('open','read')),
 visited_at TEXT NOT NULL,
 position_json TEXT NOT NULL DEFAULT '{}',
 PRIMARY KEY(entity_id,mode)
) STRICT;
CREATE INDEX workspace_activity_recent ON workspace_activity(mode,visited_at DESC);
CREATE TABLE research_summaries (
 research_id TEXT PRIMARY KEY REFERENCES researches(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(body)<=12000),
 sources_json TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 model TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
