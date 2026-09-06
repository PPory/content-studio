-- Idempotency key for "explore straight into a project": the same request must not create a second notebook.
-- SQLite can't ALTER in a UNIQUE column constraint, so the uniqueness lives in an index —
-- same semantics, NULLs stay distinct.
ALTER TABLE project_notebooks ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX project_notebooks_request_key ON project_notebooks(request_key);
