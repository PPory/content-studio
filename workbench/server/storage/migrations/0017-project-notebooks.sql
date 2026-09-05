-- Exploratory notes are independent of approved article text.
CREATE TABLE project_notebooks (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  request_key TEXT UNIQUE,
  version INTEGER NOT NULL CHECK (version >= 1),
  notes_json TEXT NOT NULL CHECK (json_valid(notes_json) AND json_type(notes_json) = 'object' AND length(notes_json) <= 250000),
  agenda_id TEXT REFERENCES content_agendas(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
) STRICT;
