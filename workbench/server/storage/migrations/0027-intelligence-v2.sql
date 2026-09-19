-- Additive migration: keep all original records, versions, statuses and links.
ALTER TABLE intel_sources ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'unknown' CHECK(origin_kind IN ('external','internal','manual','unknown'));
ALTER TABLE intel_sources ADD COLUMN origin_ref TEXT;
ALTER TABLE intel_sources ADD COLUMN channel_id TEXT;
ALTER TABLE intel_sources ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE intel_sources ADD COLUMN parent_item_id TEXT;
ALTER TABLE intel_sources ADD COLUMN root_item_id TEXT;
ALTER TABLE intel_sources ADD COLUMN provenance_group_key TEXT;
ALTER TABLE intel_sources ADD COLUMN canonical_url TEXT;
ALTER TABLE intel_sources ADD COLUMN publisher_key TEXT;
ALTER TABLE intel_sources ADD COLUMN content_hash TEXT;
ALTER TABLE intel_sources ADD COLUMN revision_of_id TEXT REFERENCES intel_sources(id);
CREATE INDEX intel_sources_identity ON intel_sources(canonical_url, created_at);
CREATE INDEX intel_sources_origin ON intel_sources(origin_kind, publisher_key);
CREATE TABLE intel_clusters (
 id TEXT PRIMARY KEY, cluster_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 cluster_kind TEXT NOT NULL, primary_source_id TEXT REFERENCES intel_sources(id),
 first_seen_at TEXT NOT NULL, last_evidence_at TEXT NOT NULL
) STRICT;
CREATE TABLE intel_cluster_members (
 cluster_id TEXT NOT NULL REFERENCES intel_clusters(id), source_id TEXT NOT NULL REFERENCES intel_sources(id),
 role TEXT NOT NULL, PRIMARY KEY(cluster_id,source_id)
) STRICT;
ALTER TABLE intel_briefs ADD COLUMN cluster_id TEXT REFERENCES intel_clusters(id);
ALTER TABLE intel_briefs ADD COLUMN editorial_state TEXT NOT NULL DEFAULT 'needs_review';
ALTER TABLE intel_briefs ADD COLUMN freshness_kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE intel_cards ADD COLUMN brief_id TEXT REFERENCES intel_briefs(id);
ALTER TABLE intel_cards ADD COLUMN cluster_id TEXT REFERENCES intel_clusters(id);
ALTER TABLE intel_cards ADD COLUMN readiness TEXT NOT NULL DEFAULT 'untriaged';
ALTER TABLE content_opportunities ADD COLUMN planning_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(planning_json));
ALTER TABLE content_opportunities ADD COLUMN readiness TEXT NOT NULL DEFAULT 'untriaged';
CREATE TABLE intel_feedback (
 id TEXT PRIMARY KEY, brief_id TEXT NOT NULL REFERENCES intel_briefs(id), version INTEGER NOT NULL,
 action TEXT NOT NULL, value INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX intel_feedback_recent ON intel_feedback(created_at DESC);
