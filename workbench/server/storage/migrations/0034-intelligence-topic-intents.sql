-- User choices and retry receipts, without rewriting historical records.
CREATE TABLE intelligence_topic_intents (
 operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
 research_id TEXT NOT NULL REFERENCES researches(id),
 data_json TEXT NOT NULL CHECK(json_valid(data_json)), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE intelligence_legacy_topics (
 kind TEXT NOT NULL CHECK(kind IN ('intel','bridge')), legacy_id TEXT NOT NULL,
 research_id TEXT NOT NULL REFERENCES researches(id), created_at TEXT NOT NULL,
 PRIMARY KEY(kind,legacy_id)
) STRICT;
