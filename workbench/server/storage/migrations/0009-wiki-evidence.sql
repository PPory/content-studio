-- 知识库证据、来源元数据和审阅状态。

ALTER TABLE books ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN published_at TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN platform TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN source_origin_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL;
ALTER TABLE books ADD COLUMN content_sha256 TEXT NOT NULL DEFAULT '' CHECK (content_sha256 = '' OR length(content_sha256) = 64);

CREATE UNIQUE INDEX books_source_url_unique ON books(source_url) WHERE source_url <> '';
CREATE UNIQUE INDEX books_origin_unique ON books(source_origin_entity_id) WHERE source_origin_entity_id IS NOT NULL;

ALTER TABLE entries ADD COLUMN definition_quote TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN definition_locator TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN definition_source_sha256 TEXT NOT NULL DEFAULT '' CHECK (definition_source_sha256 = '' OR length(definition_source_sha256) = 64);

ALTER TABLE entry_facts ADD COLUMN source_quote TEXT NOT NULL DEFAULT '';
ALTER TABLE entry_facts ADD COLUMN source_content_sha256 TEXT NOT NULL DEFAULT '' CHECK (source_content_sha256 = '' OR length(source_content_sha256) = 64);

CREATE TABLE entry_definition_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  definition TEXT NOT NULL CHECK (length(definition) BETWEEN 1 AND 500),
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  source_quote TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  source_content_sha256 TEXT NOT NULL DEFAULT '' CHECK (source_content_sha256 = '' OR length(source_content_sha256) = 64),
  reason TEXT NOT NULL DEFAULT '',
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX entry_definition_current_unique ON entry_definition_revisions(entry_id) WHERE is_current = 1;
CREATE INDEX entry_definition_history_idx ON entry_definition_revisions(entry_id, created_at DESC);

INSERT INTO entry_definition_revisions(id, entry_id, definition, source_entity_id, source_quote, source_locator, source_content_sha256, reason, is_current, created_at)
SELECT 'legacy-definition:' || e.id, e.id, e.definition, e.definition_source_id, '', COALESCE(t.title, ''), '', '迁移已有定义', 1, en.created_at
FROM entries e
JOIN entities en ON en.id = e.id
LEFT JOIN entity_text t ON t.entity_id = e.definition_source_id
WHERE e.definition_source_id IS NOT NULL AND e.definition <> '';

CREATE TABLE entry_relation_evidence (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  source_quote TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  source_content_sha256 TEXT NOT NULL DEFAULT '' CHECK (source_content_sha256 = '' OR length(source_content_sha256) = 64),
  why TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, relation_type, source_entity_id),
  FOREIGN KEY (from_id, to_id, relation_type) REFERENCES entity_relations(from_id, to_id, relation_type) ON DELETE CASCADE
) STRICT;

ALTER TABLE source_ingests RENAME TO source_ingests_legacy;

CREATE TABLE source_ingests (
  source_entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'proposed', 'applied', 'rejected', 'empty', 'failed')),
  model TEXT NOT NULL DEFAULT '',
  candidate_id TEXT REFERENCES action_candidates(id) ON DELETE SET NULL,
  source_content_sha256 TEXT NOT NULL DEFAULT '' CHECK (source_content_sha256 = '' OR length(source_content_sha256) = 64),
  entries_proposed INTEGER NOT NULL DEFAULT 0 CHECK (entries_proposed >= 0),
  facts_proposed INTEGER NOT NULL DEFAULT 0 CHECK (facts_proposed >= 0),
  relations_proposed INTEGER NOT NULL DEFAULT 0 CHECK (relations_proposed >= 0),
  contradictions_found INTEGER NOT NULL DEFAULT 0 CHECK (contradictions_found >= 0),
  rejected_ungrounded INTEGER NOT NULL DEFAULT 0 CHECK (rejected_ungrounded >= 0),
  error TEXT NOT NULL DEFAULT '',
  run_at TEXT NOT NULL
) STRICT;

INSERT INTO source_ingests(source_entity_id, status, model, candidate_id, source_content_sha256, entries_proposed, facts_proposed, relations_proposed, contradictions_found, rejected_ungrounded, error, run_at)
SELECT source_entity_id, status, model, candidate_id, '', entries_proposed, facts_proposed, relations_proposed, contradictions_found, rejected_ungrounded, error, run_at
FROM source_ingests_legacy;

DROP TABLE source_ingests_legacy;
CREATE INDEX source_ingests_status_idx ON source_ingests(status, run_at);
