CREATE TABLE IF NOT EXISTS model_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  extension_version TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_requests_provider
  ON model_requests(provider);

CREATE INDEX IF NOT EXISTS idx_model_requests_created_at
  ON model_requests(created_at);
