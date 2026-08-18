ALTER TABLE inbox ADD COLUMN capture_origin TEXT NOT NULL DEFAULT 'idea'
  CHECK (capture_origin IN ('collection','idea'));
ALTER TABLE inbox ADD COLUMN processing_mode TEXT NOT NULL DEFAULT 'triage'
  CHECK (processing_mode IN ('hold','triage'));
ALTER TABLE inbox ADD COLUMN review_status TEXT NOT NULL DEFAULT 'kept'
  CHECK (review_status IN ('pending','kept','archived'));
ALTER TABLE inbox ADD COLUMN save_note TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox ADD COLUMN selection TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox ADD COLUMN canonical_url TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox ADD COLUMN snapshot_status TEXT NOT NULL DEFAULT 'not_needed'
  CHECK (snapshot_status IN ('pending','ready','failed','not_needed'));
ALTER TABLE inbox ADD COLUMN snapshot_error TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox ADD COLUMN snapshot_at INTEGER;

UPDATE inbox
SET capture_origin = 'idea', processing_mode = 'triage', review_status = 'kept';

CREATE INDEX IF NOT EXISTS idx_inbox_collection_review
  ON inbox(capture_origin, review_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_inbox_canonical_url
  ON inbox(canonical_url) WHERE canonical_url != '';
CREATE INDEX IF NOT EXISTS idx_inbox_content_hash
  ON inbox(content_hash) WHERE content_hash != '';
