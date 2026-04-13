CREATE TABLE IF NOT EXISTS feedback_submissions (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  include_logs INTEGER NOT NULL DEFAULT 0,
  log_count INTEGER NOT NULL DEFAULT 0,
  extension_version TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback_logs (
  feedback_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feedback_id) REFERENCES feedback_submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_created_at
  ON feedback_submissions(created_at);
