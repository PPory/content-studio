ALTER TABLE intel_channels ADD COLUMN stable_key TEXT;
ALTER TABLE intel_channels ADD COLUMN source_group TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE intel_channels ADD COLUMN platform TEXT NOT NULL DEFAULT '';
ALTER TABLE intel_channels ADD COLUMN stream TEXT NOT NULL DEFAULT '';
ALTER TABLE intel_channels ADD COLUMN adapter TEXT NOT NULL DEFAULT '';
ALTER TABLE intel_channels ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE intel_channels ADD COLUMN desired_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intel_channels ADD COLUMN user_disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intel_channels ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE intel_channels ADD COLUMN access_status TEXT NOT NULL DEFAULT 'needs_review';
ALTER TABLE intel_channels ADD COLUMN poll_seconds INTEGER NOT NULL DEFAULT 3600;
ALTER TABLE intel_channels ADD COLUMN next_due_at TEXT;
ALTER TABLE intel_channels ADD COLUMN last_ingest_at TEXT;
ALTER TABLE intel_channels ADD COLUMN last_changed_at TEXT;
ALTER TABLE intel_channels ADD COLUMN last_stats_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE intel_channels ADD COLUMN baseline_json TEXT;
CREATE UNIQUE INDEX intel_channels_stable_key ON intel_channels(stable_key) WHERE stable_key IS NOT NULL;

ALTER TABLE intel_sources ADD COLUMN acquisition_identity TEXT;
ALTER TABLE intel_sources ADD COLUMN content_status TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE intel_sources ADD COLUMN rights_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE intel_sources ADD COLUMN expires_at TEXT;
ALTER TABLE intel_sources ADD COLUMN deleted_at TEXT;
ALTER TABLE intel_sources ADD COLUMN current_version_id TEXT;
ALTER TABLE intel_sources ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX intel_sources_acquisition_identity ON intel_sources(acquisition_identity) WHERE acquisition_identity IS NOT NULL;
CREATE INDEX intel_sources_expiration ON intel_sources(expires_at);

CREATE TABLE acquisition_runs (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES local_jobs(id), channel_id TEXT NOT NULL REFERENCES intel_channels(id),
 kind TEXT NOT NULL, trigger_kind TEXT NOT NULL, scheduled_slot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 outcome TEXT, checkpoint_before_json TEXT NOT NULL DEFAULT '{}', checkpoint_after_json TEXT NOT NULL DEFAULT '{}',
 stats_json TEXT NOT NULL DEFAULT '{}', coverage_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
 parser_version TEXT NOT NULL DEFAULT 'v3.1', started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(channel_id,kind,scheduled_slot)
);
CREATE INDEX acquisition_runs_channel ON acquisition_runs(channel_id,created_at DESC);
CREATE TABLE acquisition_checkpoints (
 channel_id TEXT NOT NULL REFERENCES intel_channels(id), partition_key TEXT NOT NULL, state_json TEXT NOT NULL,
 updated_at TEXT NOT NULL, PRIMARY KEY(channel_id,partition_key)
);
CREATE TABLE acquisition_snapshots (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES intel_channels(id), request_key TEXT NOT NULL,
 url TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_text TEXT NOT NULL, headers_json TEXT NOT NULL,
 observed_at TEXT NOT NULL, expires_at TEXT NOT NULL, applied_at TEXT,
 UNIQUE(channel_id,request_key,payload_hash)
);
CREATE INDEX acquisition_snapshot_cache ON acquisition_snapshots(channel_id,request_key,observed_at DESC);
CREATE TABLE acquisition_source_versions (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES intel_sources(id), content_hash TEXT NOT NULL,
 data_json TEXT NOT NULL, observed_at TEXT NOT NULL, UNIQUE(source_id,content_hash)
);
CREATE TABLE source_discoveries (
 source_id TEXT NOT NULL REFERENCES intel_sources(id), channel_id TEXT NOT NULL REFERENCES intel_channels(id),
 discovery_key TEXT NOT NULL, metadata_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 selected INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(source_id,channel_id,discovery_key)
);
CREATE TABLE acquisition_aliases (
 identity TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES intel_sources(id)
);
CREATE TABLE acquisition_observations (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES intel_channels(id), source_id TEXT REFERENCES intel_sources(id),
 observation_key TEXT NOT NULL, data_json TEXT NOT NULL, observed_at TEXT NOT NULL,
 UNIQUE(channel_id,observation_key,observed_at)
);
CREATE TABLE acquisition_segments (
 version_id TEXT NOT NULL REFERENCES acquisition_source_versions(id), ordinal INTEGER NOT NULL,
 start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, PRIMARY KEY(version_id,ordinal)
);
CREATE TABLE acquisition_tombstones (
 identity TEXT PRIMARY KEY, reason TEXT NOT NULL, deleted_at TEXT NOT NULL
);
CREATE TABLE acquisition_locks (
 lock_key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE acquisition_network_budget (
 host TEXT PRIMARY KEY, not_before TEXT NOT NULL
);
