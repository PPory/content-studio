ALTER TABLE entities ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE captures (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  capture_kind TEXT NOT NULL CHECK (capture_kind IN ('article', 'video', 'thought', 'excerpt', 'web')),
  title TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'archived', 'discarded', 'needs_review')),
  reaction TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE seeds (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  reaction TEXT NOT NULL DEFAULT '',
  source_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'keeping' CHECK (status IN ('keeping', 'written', 'dropped'))
) STRICT;

CREATE TABLE materials (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  material_type TEXT NOT NULL CHECK (material_type IN (
    '核心观点', '金句/原话', '数据/事实', '案例/故事', '框架/模型',
    '反直觉点', '个人经历', '延展问题', '标题样本', '内容角度', '平台反馈'
  )),
  body_markdown TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  source_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('不适用', '待核验', '已核验')),
  verification_note TEXT NOT NULL DEFAULT '',
  verification_method TEXT NOT NULL DEFAULT '',
  source_snapshot_sha256 TEXT,
  verified_at TEXT
) STRICT;

CREATE UNIQUE INDEX review_feedback_material_unique
  ON materials(source_entity_id, material_type)
  WHERE source_entity_id IS NOT NULL AND material_type IN ('标题样本', '内容角度', '平台反馈');

CREATE TABLE labels (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE entity_labels (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entity_id, label_id)
) STRICT;

CREATE TABLE projects (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  brief_markdown TEXT NOT NULL DEFAULT '',
  viewpoint TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  primary_platform TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '中' CHECK (priority IN ('高', '中', '低')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'generating', 'parked')),
  seed_id TEXT UNIQUE REFERENCES seeds(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE drafts (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  workflow_status TEXT NOT NULL DEFAULT '写作中' CHECK (workflow_status IN ('写作中', '待发布', '已发布', '已弃用')),
  publication_status TEXT NOT NULL DEFAULT '未发布' CHECK (publication_status IN ('未发布', '已发布')),
  UNIQUE (project_id, id)
) STRICT;

CREATE INDEX drafts_project_idx ON drafts(project_id, workflow_status);

CREATE TABLE project_primary_drafts (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (project_id, draft_id) REFERENCES drafts(project_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE project_materials (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  relation_kind TEXT NOT NULL DEFAULT 'reference' CHECK (relation_kind IN ('reference', 'evidence', 'inspiration')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, material_id)
) STRICT;

CREATE TABLE project_sources (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, source_entity_id)
) STRICT;

CREATE TABLE publication_records (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE RESTRICT,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  platform TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  published_url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  FOREIGN KEY (draft_id, revision_id) REFERENCES revisions(entity_id, id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX publication_records_draft_idx ON publication_records(draft_id, published_at DESC);

CREATE TABLE release_packages (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL UNIQUE REFERENCES drafts(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  cover_text TEXT NOT NULL DEFAULT '',
  cover_note TEXT NOT NULL DEFAULT '',
  keywords_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(keywords_json)),
  interaction_goal TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE metric_snapshots (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES publication_records(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  views INTEGER CHECK (views IS NULL OR views >= 0),
  likes INTEGER CHECK (likes IS NULL OR likes >= 0),
  comments INTEGER CHECK (comments IS NULL OR comments >= 0),
  collects INTEGER CHECK (collects IS NULL OR collects >= 0),
  shares INTEGER CHECK (shares IS NULL OR shares >= 0),
  raw_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(raw_json)),
  UNIQUE (publication_id, captured_at)
) STRICT;

CREATE TABLE reviews (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL UNIQUE REFERENCES publication_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('样本不足', '普通', '表现突出', '已沉淀')),
  basis_markdown TEXT NOT NULL DEFAULT '',
  conclusion_markdown TEXT NOT NULL,
  next_experiment_markdown TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  settlement_sha256 TEXT CHECK (settlement_sha256 IS NULL OR length(settlement_sha256) = 64)
) STRICT;

CREATE TABLE review_materials (
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (review_id, material_id)
) STRICT;

CREATE TABLE review_story_materials (
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (review_id, material_id)
) STRICT;
CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  title TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'ai_confirmed', 'import')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, revision_no),
  UNIQUE (entity_id, id)
) STRICT;

CREATE TRIGGER publication_revision_guard BEFORE INSERT ON publication_records BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM revisions r WHERE r.id = new.revision_id AND r.entity_id = new.draft_id AND r.content_sha256 = new.content_sha256
  ) THEN RAISE(ABORT, 'publication revision mismatch') END;
END;

CREATE INDEX revisions_entity_hash_idx ON revisions(entity_id, content_sha256);

CREATE TABLE books (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  reading_status TEXT NOT NULL DEFAULT '未读' CHECK (reading_status IN ('未读', '在读', '读完', '搁置')),
  source_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  knowledge_kind TEXT NOT NULL CHECK (knowledge_kind IN ('book_note', 'annotation', 'web_annotation', 'knowledge_card')),
  book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  quote_text TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  locator TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE ai_conversations (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global', 'project', 'reading')),
  scope_id TEXT,
  model TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  body_markdown TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, sequence)
) STRICT;

CREATE INDEX ai_messages_conversation_idx ON ai_messages(conversation_id, sequence);

CREATE TABLE ai_message_assets (
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (message_id, asset_id)
) STRICT;

CREATE TABLE action_candidates (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  target_id TEXT,
  expected_version TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'applied', 'rejected', 'stale')),
  proposed_by TEXT NOT NULL DEFAULT 'ai' CHECK (proposed_by IN ('ai', 'user')),
  proposed_at TEXT NOT NULL,
  confirmed_at TEXT,
  applied_at TEXT,
  result_json TEXT
) STRICT;

CREATE TABLE idempotency_records (
  key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE local_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'retry', 'done', 'failed', 'cancelled')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  due_at TEXT NOT NULL,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  deleted_at TEXT
) STRICT;

CREATE INDEX local_jobs_claim_idx ON local_jobs(status, due_at, created_at) WHERE deleted_at IS NULL;

CREATE TABLE local_job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES local_jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error TEXT NOT NULL DEFAULT '',
  UNIQUE (job_id, attempt)
) STRICT;

CREATE TABLE local_schedules (
  schedule_key TEXT PRIMARY KEY,
  job_kind TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL CHECK (interval_seconds >= 60),
  next_due_at TEXT NOT NULL,
  last_enqueued_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  payload_json TEXT NOT NULL DEFAULT '{}'
) STRICT;
