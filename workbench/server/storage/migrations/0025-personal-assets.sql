CREATE TABLE quick_note_meta (
 capture_id TEXT PRIMARY KEY REFERENCES captures(id), tags_json TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)), version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE personal_assets (
 id TEXT PRIMARY KEY REFERENCES entities(id), kind TEXT NOT NULL CHECK(kind IN ('identity','current','experience','voice')), title TEXT NOT NULL, body TEXT NOT NULL, event_date TEXT NOT NULL DEFAULT '', usage TEXT NOT NULL DEFAULT 'ask' CHECK(usage IN ('private','reference','ask')), source_note_id TEXT REFERENCES captures(id), source_version INTEGER, source_snapshot TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE personal_asset_versions (
 asset_id TEXT NOT NULL REFERENCES personal_assets(id), version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(asset_id,version)
) STRICT;
CREATE TABLE project_personal_assets (
 project_id TEXT NOT NULL REFERENCES projects(id), asset_id TEXT NOT NULL REFERENCES personal_assets(id), authorized_version INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,asset_id)
) STRICT;
