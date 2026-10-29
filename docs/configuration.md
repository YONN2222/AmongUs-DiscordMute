# Configuration

Both parts are configured with a `config.json` file. A single backslash in a JSON string is an escape character, so write Windows paths with `\\` or `/`.

## Bot config.json

The file lives in the `DiscordBot` folder. Start from `config.example.json`.

| Key | Default | Meaning |
|-----|---------|---------|
| `token` | required | Bot token from the Discord Developer Portal. |
| `clientId` | required | Application / client ID of your Discord bot. |
| `guildId` | required | ID of the Discord server where the bot is used. |
| `channelIds` | `[]` | Fallback voice channels, used only when the bot cannot tell which channel the host is in. |
| `secret` | required | Shared secret, must equal the plugin `secret`. The example uses `change-me`, replace it. |
| `botIp` | `0.0.0.0` | Address the bot listens on for the plugin. Use `localhost` when the plugin runs on the same PC. |
| `botPort` | `7264` | Port the bot listens on. |
| `databaseDialect` | `sqlite` | `sqlite` or `postgres`. |
| `databaseUrl` | unset | Connection URL, required when `databaseDialect` is `postgres`. |
| `sqlitePath` | `./data/linking.sqlite` | Location of the SQLite file. |
| `clusters` | `{ "total": 1, "shardsPerCluster": 1 }` | Cluster layout. The default suits a single server. |
| `logFormat` | `pretty` | `pretty` for the colored console, `json` for one JSON object per line (see [monitoring](monitoring.md#json-logs)). |
| `metrics.enabled` | `false` | Serve a Prometheus `/metrics` endpoint. |
| `metrics.host` | `127.0.0.1` | Address of the metrics endpoint. |
| `metrics.port` | `9464` | Port of the metrics endpoint (1 to 65535). |
| `metrics.token` | unset | Optional bearer token, at least 16 characters. |
| `disableTelemetry` | `false` | Turns anonymous telemetry off. |
| `disableUpdateCheck` | `false` | Turns the release check off. |

Example:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "clientId": "YOUR_CLIENT_ID",
  "guildId": "YOUR_GUILD_ID",
  "channelIds": [],
  "secret": "replace-this-with-your-own-secret",
  "botIp": "localhost",
  "botPort": 7264,
  "databaseDialect": "sqlite"
}
```

### Opt-out and optional keys

`disableTelemetry`, `disableUpdateCheck`, `logFormat` and `metrics` are left out of the example on purpose. Add them as extra top-level keys when you want them:

```json
{
  "disableTelemetry": true,
  "disableUpdateCheck": true,
  "logFormat": "json",
  "metrics": { "enabled": true, "token": "a-long-random-string" }
}
```

What telemetry sends, and why it is on by default, is described in the [README](../README.md#telemetry). Please consider leaving it on.

## Plugin config.json

Located in `BepInEx/DiscordMute` inside your Among Us folder. It is created on the first start of Among Us.

| Key | Default | Meaning |
|-----|---------|---------|
| `ip` | `localhost` | IP address of the machine running the bot. |
| `botPort` | `7264` | Port of the bot. |
| `secret` | `change-me` | Shared secret, must equal the bot `secret`. |
| `exe` | empty | Full path to `start.bat` in the `DiscordBot` folder. |
| `bridgeLogsToBotConsole` | `false` | Forward all plugin and BepInEx logs to the bot console. Own warnings and errors are always forwarded. |
| `disableUpdateCheck` | `false` | Turns the release check off. It is not written to the file unless you set it to `true`. |

Example:

```json
{
  "ip": "localhost",
  "botPort": 7264,
  "secret": "replace-this-with-your-own-secret",
  "exe": "C:\\Path\\To\\DiscordBot\\start.bat",
  "bridgeLogsToBotConsole": false
}
```

To turn the plugin update check off, add `"disableUpdateCheck": true` to this file.
