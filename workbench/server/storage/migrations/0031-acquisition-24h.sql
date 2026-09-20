ALTER TABLE acquisition_runs ADD COLUMN window_start_at TEXT;
ALTER TABLE acquisition_runs ADD COLUMN window_end_at TEXT;

ALTER TABLE acquisition_batches ADD COLUMN window_start_at TEXT;
ALTER TABLE acquisition_batches ADD COLUMN window_end_at TEXT;

CREATE INDEX acquisition_runs_window ON acquisition_runs(window_end_at, channel_id);
