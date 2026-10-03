-- Preserve existing account, login challenge, and submission columns.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_users_email ON users(email);
CREATE TABLE login_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_digest TEXT NOT NULL,
  locale TEXT NOT NULL,
  requester_ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempt_window_started_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT
);
CREATE INDEX ix_challenges_email ON login_challenges(email, created_at);
CREATE INDEX ix_challenges_ip ON login_challenges(requester_ip_hash, created_at);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  authenticated_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_sessions_expiry ON sessions(expires_at);
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  notes TEXT,
  original_filename TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  storage_ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'legacy' CHECK(status IN
    ('legacy', 'staged', 'approved', 'syncing', 'upstream_uploaded', 'published')),
  upload_id TEXT UNIQUE,
  r2_etag TEXT,
  ia_item TEXT,
  published_at TEXT,
  lease_token TEXT,
  lease_until INTEGER,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX ix_submissions_user ON submissions(user_id, created_at);
CREATE INDEX ix_submissions_sync ON submissions(status, next_attempt_at);
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 1073741824),
  status TEXT NOT NULL CHECK(status IN ('reserved', 'staged', 'released')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  cleanup_after INTEGER NOT NULL
);
CREATE INDEX ix_uploads_capacity ON uploads(status);
