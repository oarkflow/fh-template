CREATE TABLE IF NOT EXISTS key_store (
  subject_id TEXT PRIMARY KEY, version TEXT NOT NULL, blob BLOB NOT NULL, created_at TEXT NOT NULL
);
