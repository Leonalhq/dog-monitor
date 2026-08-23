export const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  seeded_at TEXT,
  last_started_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  image_url TEXT,
  breed TEXT,
  age TEXT,
  sex TEXT,
  location TEXT,
  status TEXT,
  description TEXT,
  content_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  disappeared_at TEXT,
  raw_data_json TEXT,
  interest INTEGER CHECK(interest IN (0, 1)),
  analysis_json TEXT,
  analysis_content_hash TEXT,
  UNIQUE(source_id, external_id)
);

CREATE INDEX IF NOT EXISTS dogs_source_last_seen_idx
  ON dogs(source_id, last_seen_at);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT
);

CREATE INDEX IF NOT EXISTS observations_dog_time_idx
  ON observations(dog_id, observed_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  discord_message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  hidden_at TEXT,
  UNIQUE(dog_id, notification_type)
);

CREATE INDEX IF NOT EXISTS notifications_sent_at_idx
  ON notifications(sent_at);
`;
