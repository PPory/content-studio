CREATE TABLE researches (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  question TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  open_questions TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE research_references (
  research_id TEXT NOT NULL REFERENCES researches(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('material','wiki','source','capture','seed')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(research_id,entity_id)
) STRICT;
CREATE TABLE research_conversations (
  research_id TEXT NOT NULL REFERENCES researches(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(research_id,conversation_id)
) STRICT;
CREATE TABLE research_projects (
  research_id TEXT NOT NULL REFERENCES researches(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  selected_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(research_id,project_id)
) STRICT;
CREATE TABLE work_states (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
  position_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(position_json))
) STRICT;
