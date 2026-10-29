CREATE TABLE instances (
  instance_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('self-host','hosted')),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_packet_id TEXT NOT NULL,
  bot_version TEXT NOT NULL,
  plugin_versions TEXT NOT NULL,
  among_us_versions TEXT NOT NULL,
  features TEXT NOT NULL,
  unique_users INTEGER NOT NULL,
  active_games INTEGER NOT NULL,
  guilds INTEGER NOT NULL,
  connected_plugins INTEGER NOT NULL,
  latency_avg_ms REAL NOT NULL
);

CREATE INDEX instances_last_seen ON instances(last_seen_at);

CREATE TABLE daily_counters (
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (day, mode, metric)
);
