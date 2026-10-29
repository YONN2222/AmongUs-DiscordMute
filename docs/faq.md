# FAQ

## The bot says the secret was rejected

The plugin and bot `secret` must match exactly. The most common cause is a plugin `config.json` that is invalid JSON, usually from a single backslash in the `exe` path. The plugin then silently falls back to its defaults, including the secret `change-me`. Use `\\` or `/` in paths and look for `Failed to read plugin config` in `BepInEx/LogOutput.log`.

## The bot says the plugin is outdated

The plugin and the bot only work together at matching versions. Update both from the same release.

## Nobody gets muted

- The lobby host must be linked (`/link self`) and sitting in a Discord voice channel. DiscordMute mutes the channel the host is in.
- You must be the host of an online or LAN lobby. Freeplay does nothing.
- If the bot cannot tell which channel the host is in, it falls back to `channelIds`.
- Run `/testconnection` to check that the bot reaches the plugin.

## Players stay muted after a crash

On the next start the bot unmutes the players it muted itself. It leaves mutes it did not apply alone. If someone was muted by hand, unmute them in Discord.

## I see an update notice

A newer release exists on GitHub. The bot logs it at start and daily. The plugin shows it once in lobby chat when you host. Update the plugin and the bot together.

## How do I turn off telemetry or the update check?

Add `"disableTelemetry": true` and/or `"disableUpdateCheck": true` to the bot `config.json`. For the plugin, add `"disableUpdateCheck": true` to its `config.json`. See [configuration](configuration.md) and the [README](../README.md#telemetry) for exactly what is sent.

## Why does my Windows path break the config?

JSON treats `\` as an escape character. Write `"C:\\Path\\To\\start.bat"` or `"C:/Path/To/start.bat"`.

## Is itch.io supported?

No. The itch.io build is 32-bit. Steam, Epic Games and Microsoft Store builds are 64-bit and use the x64 BepInEx build.
