-- Derived reading and review state; originals, discovery paths and versions stay intact.
CREATE TABLE acquisition_processing (
 source_id TEXT PRIMARY KEY REFERENCES intel_sources(id), content_hash TEXT NOT NULL,
 rule_version TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)), processed_at TEXT NOT NULL
);
CREATE TABLE acquisition_semantic_cache (
 content_hash TEXT NOT NULL, rule_version TEXT NOT NULL, task TEXT NOT NULL,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(content_hash,rule_version,task)
);
CREATE TABLE acquisition_cluster_reviews (
 cluster_id TEXT PRIMARY KEY REFERENCES intel_clusters(id), status TEXT NOT NULL DEFAULT 'unreviewed'
 CHECK(status IN ('unreviewed','kept','ignored','superseded')),
 manual INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)),
 updated_at TEXT NOT NULL
);
CREATE TABLE acquisition_review_members (
 source_id TEXT PRIMARY KEY REFERENCES intel_sources(id), cluster_id TEXT NOT NULL REFERENCES intel_clusters(id)
);
CREATE TABLE acquisition_review_actions (
 id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL REFERENCES intel_clusters(id),
 action TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)), created_at TEXT NOT NULL
);
