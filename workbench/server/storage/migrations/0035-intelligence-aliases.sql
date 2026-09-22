CREATE TABLE IF NOT EXISTS intel_brief_aliases (
 alias_id TEXT PRIMARY KEY REFERENCES intel_briefs(id),
 canonical_id TEXT NOT NULL REFERENCES intel_briefs(id),
 created_at TEXT NOT NULL,
 CHECK(alias_id<>canonical_id)
);
