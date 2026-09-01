-- Content Bridge is additive: Living Wiki stays the knowledge source of truth.

CREATE TABLE content_agendas (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  audience TEXT NOT NULL DEFAULT '' CHECK (length(audience) <= 1000),
  problem_space TEXT NOT NULL DEFAULT '' CHECK (length(problem_space) <= 2000),
  desired_judgment TEXT NOT NULL CHECK (length(desired_judgment) BETWEEN 1 AND 2000),
  value_commitment TEXT NOT NULL DEFAULT '' CHECK (length(value_commitment) <= 2000),
  related_product TEXT NOT NULL DEFAULT '' CHECK (length(related_product) <= 1000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL))
) STRICT;

CREATE INDEX content_agendas_status_updated_idx ON content_agendas(status, updated_at DESC);

CREATE TABLE audience_problems (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 500),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 2000),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('hotspot', 'insight_report', 'social_post', 'comment', 'feedback', 'manual')),
  source_ref TEXT NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 500),
  pattern TEXT NOT NULL DEFAULT 'feedback' CHECK (pattern IN ('trend', 'frequency', 'knowledge_gap', 'feedback')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL))
) STRICT;

CREATE INDEX audience_problems_status_updated_idx ON audience_problems(status, updated_at DESC);
CREATE INDEX audience_problems_source_idx ON audience_problems(source_kind, source_ref);

CREATE TABLE audience_problem_sources (
  problem_id TEXT NOT NULL REFERENCES audience_problems(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('hotspot', 'insight_report', 'social_post', 'comment', 'feedback', 'manual')),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  evidence_text TEXT NOT NULL CHECK (length(evidence_text) BETWEEN 1 AND 8000),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (problem_id, source_kind, source_id)
) STRICT;

CREATE INDEX audience_problem_sources_source_idx ON audience_problem_sources(source_kind, source_id);

CREATE TABLE content_opportunities (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  wiki_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE RESTRICT,
  audience_problem_id TEXT NOT NULL REFERENCES audience_problems(id) ON DELETE RESTRICT,
  agenda_id TEXT REFERENCES content_agendas(id) ON DELETE SET NULL,
  core_claim TEXT NOT NULL CHECK (length(core_claim) BETWEEN 1 AND 4000),
  knowledge_explanation TEXT NOT NULL CHECK (length(knowledge_explanation) BETWEEN 1 AND 8000),
  cognitive_gap TEXT NOT NULL CHECK (length(cognitive_gap) BETWEEN 1 AND 4000),
  dominant_action TEXT NOT NULL CHECK (dominant_action IN ('knowledge', 'judgment', 'experience', 'demonstration')),
  fit TEXT NOT NULL CHECK (fit IN ('strong', 'medium', 'weak')),
  fit_reason TEXT NOT NULL CHECK (length(fit_reason) BETWEEN 1 AND 4000),
  construction_json TEXT NOT NULL CHECK (json_valid(construction_json) AND json_type(construction_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL))
) STRICT;

CREATE INDEX content_opportunities_status_updated_idx ON content_opportunities(status, updated_at DESC);
CREATE INDEX content_opportunities_wiki_idx ON content_opportunities(wiki_page_id, updated_at DESC);
CREATE INDEX content_opportunities_problem_idx ON content_opportunities(audience_problem_id, updated_at DESC);
CREATE INDEX content_opportunities_agenda_idx ON content_opportunities(agenda_id, updated_at DESC);

CREATE TABLE content_project_opportunities (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES content_opportunities(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'supporting')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, opportunity_id)
) STRICT;

CREATE UNIQUE INDEX content_project_primary_opportunity_unique
  ON content_project_opportunities(project_id) WHERE role = 'primary';
CREATE INDEX content_project_opportunities_opportunity_idx
  ON content_project_opportunities(opportunity_id, created_at DESC);
