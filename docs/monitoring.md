# Monitoring

## Prometheus endpoint

The bot can serve metrics in Prometheus format. It is off by default. Enable it in the bot `config.json`:

```json
{
  "metrics": { "enabled": true, "host": "127.0.0.1", "port": 9464, "token": "a-long-random-string" }
}
```

Metrics from the gateway and all cluster processes are aggregated and served at `GET /metrics`. Any other path returns 404.

- Keep `host` at `127.0.0.1` unless the port is behind a firewall or a private network. `0.0.0.0` exposes it on every interface.
- `token` is optional and needs at least 16 characters. When set, requests need `Authorization: Bearer <token>`, otherwise they get 401.

Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: discordmute
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: a-long-random-string
    static_configs:
      - targets: ["127.0.0.1:9464"]
```

## Metrics

| Metric | Type | Meaning |
|--------|------|---------|
| `discordmute_plugin_events_total{type}` | counter | Events from plugins by type: `lobby`, `game-start`, `meeting-start`, `meeting-end`, `link-chat`. |
| `discordmute_games_muted_total` | counter | Games for which muting was started. |
| `discordmute_plugins_connected` | gauge | Currently connected plugins. |
| `discordmute_active_games` | gauge | Games currently in progress. |
| `discordmute_plugin_sessions{plugin_version,game_version}` | gauge | Connected plugin sessions per plugin and Among Us version. |
| `discordmute_cluster_snapshot_failures_total` | counter | Failed cluster snapshot requests. |
| `discordmute_mutes_total{action}` | counter | Mute and unmute operations (`mute` or `unmute`). |
| `discordmute_mute_failures_total` | counter | Failed mute and unmute operations. |
| `discordmute_mute_latency_seconds` | histogram | Latency of mute and unmute operations. |
| `discordmute_rate_limit_hits_total` | counter | Discord rate limit hits. |
| `discordmute_guilds` | gauge | Guilds served. |
| `discordmute_cluster_guilds{cluster}` | gauge | Guilds served per cluster. |
| `discordmute_cluster_ws_ping_seconds{cluster}` | gauge | Discord gateway websocket ping per cluster. |
| `discordmute_process_resident_memory_bytes{process}` | gauge | Resident memory per process. |

## JSON logs

Set `"logFormat": "json"` to write one JSON object per line to stdout, which log shippers such as Loki can parse. Fields:

| Field | Meaning |
|-------|---------|
| `time` | ISO 8601 timestamp (UTC). |
| `level` | `info`, `warn`, `error`, `success` or `debug`. |
| `module` | Source module, for example `bot`, `mute`, `metrics`, `telemetry`, `updates`. |
| `process` | Process name, for example `main` or a cluster. |
| `msg` | The message. Tokens and secrets are redacted. |
| `error` | Only present when extra context or an error was logged: stack trace or serialized context, redacted. |
