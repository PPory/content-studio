CREATE TABLE content_series (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description_markdown TEXT NOT NULL DEFAULT '' CHECK (length(description_markdown) <= 2000),
  audience TEXT NOT NULL DEFAULT '' CHECK (length(audience) <= 200),
  outcome TEXT NOT NULL DEFAULT '' CHECK (length(outcome) <= 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'parked', 'completed'))
) STRICT;

CREATE TABLE series_chapters (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES content_series(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 500),
  position INTEGER NOT NULL CHECK (position > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (series_id, position),
  UNIQUE (series_id, project_id)
) STRICT;

CREATE UNIQUE INDEX series_chapters_project_unique
  ON series_chapters(project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX series_chapters_series_idx
  ON series_chapters(series_id, position);
