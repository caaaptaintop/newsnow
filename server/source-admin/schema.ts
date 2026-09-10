export const sourceAdminSchema = [
  `CREATE TABLE IF NOT EXISTS source_config_meta_v1 (
    id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `INSERT OR IGNORE INTO source_config_meta_v1(id) VALUES(1)`,
  `CREATE TABLE IF NOT EXISTS source_config_published_v1 (
    source_id TEXT PRIMARY KEY, topic TEXT NOT NULL, version INTEGER NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)), updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS source_config_published_topic_v1 ON source_config_published_v1(topic, source_id)`,
  `CREATE TABLE IF NOT EXISTS source_config_drafts_v1 (
    source_id TEXT PRIMARY KEY, topic TEXT NOT NULL, base_version INTEGER NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)), updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS source_config_drafts_topic_v1 ON source_config_drafts_v1(topic, source_id)`,
  `CREATE TABLE IF NOT EXISTS source_config_history_v1 (
    source_id TEXT NOT NULL, version INTEGER NOT NULL, topic TEXT NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)), published_at INTEGER NOT NULL,
    published_by TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(source_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS source_config_history_topic_v1 ON source_config_history_v1(topic, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS source_health_rollup_v1 (
    source_id TEXT PRIMARY KEY, topic TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ok','partial','error')),
    checked_at INTEGER NOT NULL, last_success_at INTEGER, last_error_at INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL CHECK(json_valid(data))
  )`,
  `CREATE INDEX IF NOT EXISTS source_health_topic_v1 ON source_health_rollup_v1(topic, status, checked_at DESC)`,
]
