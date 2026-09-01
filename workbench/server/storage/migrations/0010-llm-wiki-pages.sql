-- Karpathy LLM Wiki 的持久知识层。
-- Raw 仍由 books / book_documents 保存；这里保存 AI 编译后的完整页面、版本、引用、链接和演化日志。

CREATE TABLE wiki_schema_versions (
  version INTEGER PRIMARY KEY,
  rules_markdown TEXT NOT NULL CHECK (length(rules_markdown) > 100),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX wiki_schema_active_unique ON wiki_schema_versions(is_active) WHERE is_active = 1;

INSERT INTO wiki_schema_versions(version, rules_markdown, is_active, created_at) VALUES (
  1,
  '# LLM Wiki Schema\n\nRaw 来源不可修改。Wiki 保存完整、互相连接、持续修订的知识页面。Ingest 必须阅读全文，先生成来源摘要，再优先更新已有页面，同时保留引用、冲突与演化原因。Query 优先读取 Wiki；可复用的比较、分析和新连接经用户确认后归档。Lint 检查矛盾、陈旧主张、孤页、缺页、缺失链接、缺失引用与知识空白。AI 只生成候选，用户确认后才写入。',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

-- 每次编译先冻结 AI 实际读到的 Raw。原文随后即使被修订，历史页面版本仍能回到当时证据。
CREATE TABLE wiki_source_snapshots (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  title TEXT NOT NULL DEFAULT '',
  locator TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_entity_id, content_sha256)
) STRICT;

CREATE INDEX wiki_source_snapshots_source_idx ON wiki_source_snapshots(source_entity_id, created_at DESC);

CREATE TABLE wiki_change_sets (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('migration', 'ingest', 'query', 'lint', 'manual')),
  source_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  source_snapshot_id TEXT REFERENCES wiki_source_snapshots(id) ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES action_candidates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL REFERENCES wiki_schema_versions(version),
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
  created_at TEXT NOT NULL,
  applied_at TEXT
) STRICT;

CREATE INDEX wiki_change_sets_time_idx ON wiki_change_sets(created_at DESC);

CREATE TABLE wiki_pages (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  page_type TEXT NOT NULL CHECK (page_type IN (
    'source_summary', 'concept', 'person', 'organization', 'method', 'topic',
    'comparison', 'overview', 'synthesis', 'work', 'stance'
  )),
  summary TEXT NOT NULL CHECK (length(summary) <= 1200),
  body_markdown TEXT NOT NULL CHECK (length(body_markdown) > 0),
  source_entity_id TEXT REFERENCES entities(id) ON DELETE RESTRICT,
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  schema_version INTEGER NOT NULL REFERENCES wiki_schema_versions(version),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX wiki_pages_title_unique ON wiki_pages(title COLLATE NOCASE);
CREATE UNIQUE INDEX wiki_pages_source_summary_unique ON wiki_pages(source_entity_id) WHERE page_type = 'source_summary';
CREATE INDEX wiki_pages_type_updated_idx ON wiki_pages(page_type, updated_at DESC);

CREATE TABLE wiki_page_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL,
  page_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  change_set_id TEXT NOT NULL REFERENCES wiki_change_sets(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(page_id, revision)
) STRICT;

CREATE INDEX wiki_page_revisions_page_idx ON wiki_page_revisions(page_id, revision DESC);

CREATE TABLE wiki_page_sources (
  page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  source_snapshot_id TEXT REFERENCES wiki_source_snapshots(id) ON DELETE RESTRICT,
  source_quote TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  source_content_sha256 TEXT NOT NULL DEFAULT '' CHECK (source_content_sha256 = '' OR length(source_content_sha256) = 64),
  contribution TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (page_id, source_entity_id, source_quote)
) STRICT;

CREATE INDEX wiki_page_sources_source_idx ON wiki_page_sources(source_entity_id, page_id);

-- 当前页面来源之外，给每个历史版本单独保留当时使用的证据。
CREATE TABLE wiki_revision_sources (
  revision_id TEXT NOT NULL REFERENCES wiki_page_revisions(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  source_snapshot_id TEXT REFERENCES wiki_source_snapshots(id) ON DELETE RESTRICT,
  source_quote TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  contribution TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (revision_id, source_entity_id, source_quote)
) STRICT;

CREATE INDEX wiki_revision_sources_snapshot_idx ON wiki_revision_sources(source_snapshot_id, revision_id);

CREATE TABLE wiki_page_links (
  from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (length(relation) BETWEEN 1 AND 120),
  why TEXT NOT NULL DEFAULT '',
  change_set_id TEXT NOT NULL REFERENCES wiki_change_sets(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_page_id, to_page_id, relation),
  CHECK (from_page_id <> to_page_id)
) STRICT;

CREATE INDEX wiki_page_links_to_idx ON wiki_page_links(to_page_id, relation);

CREATE TABLE wiki_operation_log (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL UNIQUE REFERENCES wiki_change_sets(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('migration', 'ingest', 'query', 'lint', 'manual')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX wiki_operation_log_time_idx ON wiki_operation_log(created_at DESC);

CREATE TABLE wiki_legacy_entries (
  page_id TEXT PRIMARY KEY REFERENCES wiki_pages(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT
) STRICT;

ALTER TABLE source_ingests ADD COLUMN pages_proposed INTEGER NOT NULL DEFAULT 0 CHECK (pages_proposed >= 0);
ALTER TABLE source_ingests ADD COLUMN page_links_proposed INTEGER NOT NULL DEFAULT 0 CHECK (page_links_proposed >= 0);

-- 旧架构的原子词条候选不能再接受，否则会绕过完整 Wiki 页面层。
UPDATE action_candidates
SET status='stale'
WHERE status='proposed' AND json_extract(payload_json, '$.kind') IN ('wiki.ingest', 'wiki.lint');

UPDATE source_ingests
SET status='failed', error='知识库已升级为完整 Wiki 页面，请重新编译'
WHERE candidate_id IN (
  SELECT id FROM action_candidates WHERE status='stale' AND json_extract(payload_json, '$.kind')='wiki.ingest'
);

-- 旧词条不是废数据。以独立实体迁成第一版页面，避免旧词条刷新 FTS 时覆盖 Wiki 正文。
INSERT INTO wiki_change_sets(id, operation, title, summary, schema_version, status, created_at, applied_at)
SELECT 'wiki-migration-v1', 'migration', '迁移旧词条', '把旧词条、事实和关系迁入完整 Wiki 页面', 1, 'applied',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM entries);

INSERT INTO entities(id, entity_type, created_at, updated_at)
SELECT 'wiki:' || e.id, 'wiki_page', en.created_at, en.updated_at
FROM entries e JOIN entities en ON en.id=e.id AND en.deleted_at IS NULL;

INSERT INTO wiki_pages(id, title, page_type, summary, body_markdown, source_entity_id, current_revision, schema_version, created_at, updated_at)
SELECT 'wiki:' || e.id, e.name,
  CASE e.entry_kind WHEN 'product' THEN 'organization' ELSE e.entry_kind END,
  e.definition,
  '# ' || e.name || char(10) || char(10) || e.definition ||
  CASE WHEN EXISTS (SELECT 1 FROM entry_facts f WHERE f.entry_id=e.id AND f.status<>'superseded')
    THEN char(10) || char(10) || '## 已知事实' || char(10) || char(10) ||
      (SELECT group_concat('- ' || statement, char(10)) FROM (
        SELECT statement FROM entry_facts f WHERE f.entry_id=e.id AND f.status<>'superseded' ORDER BY f.created_at, f.id
      ))
    ELSE '' END,
  NULL, 1, 1, en.created_at, en.updated_at
FROM entries e JOIN entities en ON en.id=e.id AND en.deleted_at IS NULL;

INSERT INTO entity_text(entity_id, title, body, updated_at)
SELECT id, title, body_markdown, updated_at FROM wiki_pages;

INSERT INTO wiki_legacy_entries(page_id, entry_id)
SELECT 'wiki:' || e.id, e.id FROM entries e JOIN entities en ON en.id=e.id AND en.deleted_at IS NULL;

INSERT INTO wiki_page_revisions(id, page_id, revision, title, page_type, summary, body_markdown, change_set_id, reason, created_at)
SELECT 'wiki-revision-v1:' || id, id, 1, title, page_type, summary, body_markdown,
       'wiki-migration-v1', '由旧词条迁入，等待后续来源重新编译', updated_at
FROM wiki_pages
WHERE EXISTS (SELECT 1 FROM wiki_change_sets WHERE id='wiki-migration-v1');

INSERT OR IGNORE INTO wiki_page_sources(page_id, source_entity_id, source_quote, source_locator, source_content_sha256, contribution, created_at)
SELECT 'wiki:' || e.id, e.definition_source_id, e.definition_quote, e.definition_locator, e.definition_source_sha256, '旧词条定义', en.updated_at
FROM entries e JOIN entities en ON en.id=e.id
WHERE e.definition_source_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM wiki_legacy_entries m WHERE m.entry_id=e.id);

INSERT OR IGNORE INTO wiki_page_sources(page_id, source_entity_id, source_quote, source_locator, source_content_sha256, contribution, created_at)
SELECT 'wiki:' || f.entry_id, f.source_entity_id, f.source_quote, f.source_locator, f.source_content_sha256, f.statement, f.created_at
FROM entry_facts f
WHERE EXISTS (SELECT 1 FROM wiki_legacy_entries m WHERE m.entry_id=f.entry_id);

INSERT OR IGNORE INTO wiki_page_links(from_page_id, to_page_id, relation, why, change_set_id, created_at)
SELECT 'wiki:' || r.from_id, 'wiki:' || r.to_id, r.relation_type, COALESCE((
  SELECT ev.why FROM entry_relation_evidence ev
  WHERE ev.from_id=r.from_id AND ev.to_id=r.to_id AND ev.relation_type=r.relation_type
  ORDER BY ev.created_at LIMIT 1
), ''), 'wiki-migration-v1', r.created_at
FROM entity_relations r
WHERE EXISTS (SELECT 1 FROM wiki_legacy_entries m WHERE m.entry_id=r.from_id)
  AND EXISTS (SELECT 1 FROM wiki_legacy_entries m WHERE m.entry_id=r.to_id)
  AND EXISTS (SELECT 1 FROM wiki_change_sets WHERE id='wiki-migration-v1');

INSERT INTO wiki_operation_log(id, change_set_id, operation, title, summary, created_at)
SELECT 'wiki-log-v1', 'wiki-migration-v1', 'migration', '迁移旧词条', '旧词条已成为 Wiki 页面的初始草稿；原事实与来源仍完整保留。', applied_at
FROM wiki_change_sets WHERE id='wiki-migration-v1';
