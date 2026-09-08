CREATE TABLE intel_directions (
 id TEXT PRIMARY KEY,
 connection_json TEXT NOT NULL CHECK(json_valid(connection_json)),
 research_id TEXT REFERENCES researches(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
