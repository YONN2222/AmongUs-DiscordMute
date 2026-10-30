DELETE FROM daily_counters;
DELETE FROM instances;

INSERT INTO instances (
  instance_id, mode, first_seen_at, last_seen_at, last_packet_id, bot_version,
  plugin_versions, among_us_versions, features, unique_users, active_games,
  guilds, connected_plugins, latency_avg_ms
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'self-host', 1760000000000, 1760003600000, '21111111-1111-4111-8111-111111111111', '1.0.0', '{"1.2.0":3}', '{"2026.3.25":3}', '{}', 40, 1, 2, 3, 120.5),
  ('33333333-3333-4333-8333-333333333333', 'hosted', 1760000000000, 1760003600000, '43333333-3333-4333-8333-333333333333', '1.0.0', '{"1.2.0":8}', '{"2026.3.25":8}', '{}', 16, 0, 5, 8, 98.2);

INSERT INTO daily_counters (day, mode, metric, value) VALUES
  ('2026-10-01', 'self-host', 'games_muted', 600),
  ('2026-10-02', 'self-host', 'games_muted', 400),
  ('2026-10-02', 'hosted', 'games_muted', 234),
  ('2026-10-02', 'self-host', 'mutes', 5000);
