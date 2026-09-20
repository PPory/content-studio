CREATE TABLE acquisition_batches (
 id TEXT PRIMARY KEY, trigger_kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
 status TEXT NOT NULL DEFAULT 'running', channel_count INTEGER NOT NULL
) STRICT;
ALTER TABLE acquisition_runs ADD COLUMN batch_id TEXT REFERENCES acquisition_batches(id);
ALTER TABLE acquisition_runs ADD COLUMN health_status TEXT;
CREATE INDEX acquisition_runs_batch ON acquisition_runs(batch_id);
CREATE TABLE acquisition_run_items (
 run_id TEXT NOT NULL REFERENCES acquisition_runs(id), source_id TEXT NOT NULL REFERENCES intel_sources(id),
 stream TEXT NOT NULL, outcome TEXT NOT NULL, observed_at TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id,stream)
) STRICT;
CREATE INDEX acquisition_run_items_source ON acquisition_run_items(source_id);
