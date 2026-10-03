-- Additive to the initial scaffold. Legacy columns stay available for imports.
ALTER TABLE users ADD COLUMN is_reviewer INTEGER NOT NULL DEFAULT 0 CHECK(is_reviewer IN (0,1));
ALTER TABLE login_challenges ADD COLUMN verification_token TEXT;
ALTER TABLE uploads ADD COLUMN idempotency_key TEXT;
ALTER TABLE uploads ADD COLUMN phase TEXT NOT NULL DEFAULT 'initializing'
  CHECK(phase IN ('initializing','uploading','completing','complete','bound','cleanup','released'));
ALTER TABLE uploads ADD COLUMN multipart_id TEXT;
ALTER TABLE uploads ADD COLUMN etag TEXT;
ALTER TABLE uploads ADD COLUMN lease_token TEXT;
ALTER TABLE uploads ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX ix_uploads_idempotency ON uploads(user_id,idempotency_key);
CREATE TABLE upload_parts (
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  part_number INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY(upload_id,part_number)
);
ALTER TABLE submissions ADD COLUMN review_decision TEXT NOT NULL DEFAULT 'pending'
  CHECK(review_decision IN ('pending','accepted','rejected'));
ALTER TABLE submissions ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE submissions ADD COLUMN reviewed_at TEXT;
ALTER TABLE submissions ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'legacy'
  CHECK(lifecycle IN ('legacy','pending','approved','transferring','upstream_accepted','cleanup_pending','published','rejected','failed'));
ALTER TABLE submissions ADD COLUMN upstream_url TEXT;
CREATE INDEX ix_submissions_review ON submissions(review_decision,lifecycle,created_at);
CREATE TABLE transfer_jobs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  kind TEXT NOT NULL CHECK(kind IN ('publish','delete')),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK(state IN ('queued','initiate','part','complete','verify','cleanup','done','failed')),
  resume_state TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  step INTEGER NOT NULL DEFAULT 0,
  multipart_id TEXT,
  expected_etag TEXT,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE transfer_parts (
  job_id TEXT NOT NULL REFERENCES transfer_jobs(id),
  part_number INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY(job_id,part_number)
);
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES transfer_jobs(id),
  generation INTEGER NOT NULL,
  step INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  UNIQUE(job_id,generation,step)
);
CREATE INDEX ix_outbox_pending ON outbox(sent_at,created_at);
CREATE TABLE storage_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  reservations_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reservations_enabled IN (0,1)),
  last_reconciled_at INTEGER,
  discrepancy TEXT
);
INSERT INTO storage_control(id) VALUES(1);
CREATE TABLE migration_imports (
  source_id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  account_count INTEGER NOT NULL,
  submission_count INTEGER NOT NULL
);
