-- Stage 9 tightens Preview freshness and Opportunity -> Project idempotency.

ALTER TABLE content_opportunities
  ADD COLUMN preview_freshness_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(preview_freshness_json) AND json_type(preview_freshness_json) = 'object');

CREATE UNIQUE INDEX content_opportunity_primary_project_unique
  ON content_project_opportunities(opportunity_id)
  WHERE role = 'primary';
