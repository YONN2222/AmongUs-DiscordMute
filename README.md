<div align="center">
  <img src="assets/AmongUsDiscordMuteLarge.png" alt="DiscordMute" width="600" />

  <p><strong>Automatic Discord voice muting for Among Us.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/C%23-239120?style=for-the-badge&logo=csharp&logoColor=white" alt="C#" />
    <img src="https://img.shields.io/badge/BepInEx-1f1f1f?style=for-the-badge" alt="BepInEx" />
    <img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="discord.js" />
    <img src="https://img.shields.io/badge/GPLv3-blue?style=for-the-badge" alt="License" />
  </p>
</div>

<br />

> DiscordMute is an Among Us companion mod that automatically mutes and unmutes players in Discord during a game, keeping voice chat aligned with the round state. It also supports EHR Blackmailer behavior, so blackmailed players stay muted during meetings instead of speaking normally in Discord.

## 1. Overview

I built DiscordMute because my friend group kept talking during live rounds and didn't want to manually mute and unmute themselves every game. It's made up of two pieces you install together: an Among Us plugin (`DLL`) and a Discord bot (`DiscordBot`).

## 2. Quick start

1. Install the 64-bit BepInEx build into your Among Us folder and copy `DiscordMute.dll` into `BepInEx/plugins`.
2. Start Among Us once, then set `ip`, `secret` and `exe` in the plugin `config.json` that DiscordMute creates in `BepInEx/DiscordMute`.
3. In `DiscordBot`, rename `config.example.json` to `config.json` and fill in `token`, `clientId`, `guildId` and the same `secret`.
4. Host a lobby (online or LAN), join a Discord voice channel and run `/link self`.
5. Send the phrase the bot gives you in Among Us Free Chat. You are linked.

The full walkthrough, including the itch.io note and path escaping, is in [docs/content/1.getting-started/2.self-host-setup.md](docs/content/1.getting-started/2.self-host-setup.md).

### Documentation

The documentation is a Docus site in `docs/`. To read it as a website, run `cd docs && bun install && bun run dev`.

- [Self-host setup](docs/content/1.getting-started/2.self-host-setup.md)
- [Hosted setup](docs/content/1.getting-started/3.hosted-setup.md)
- [Bot configuration](docs/content/2.configuration/1.bot-config.md) and [plugin configuration](docs/content/2.configuration/2.plugin-config.md)
- [Commands](docs/content/3.commands/1.slash-commands.md)
- [Metrics](docs/content/4.monitoring/1.metrics.md) and [JSON logs](docs/content/4.monitoring/2.json-logs.md)
- [Telemetry](docs/content/5.privacy/1.telemetry.md) and [update check](docs/content/5.privacy/2.update-check.md)
- [Server setup](docs/content/6.server-setup/1.setup-panel.md) and [game features](docs/content/6.server-setup/2.game-features.md)
- [FAQ](docs/content/7.faq/1.faq.md)

## 3. Linking Discord users to Among Us players

DiscordMute needs to know which Discord user belongs to which Among Us player name before it can mute the correct person.

The normal flow is:

1. A player runs `/link self` in Discord.
2. The bot replies with a short one-time phrase such as `link-AB12`.
3. The player opens Free Chat in an Among Us lobby and sends that phrase exactly.
4. The plugin catches the phrase before it appears in chat and sends the detected Among Us name to the bot. The bot links the account and answers in-game with "Account linked successfully!" or a failure message.

Link phrases expire after 5 minutes. The bot stores links in `DiscordBot/data/linking.sqlite`.

### Discord bot commands

| Command                         | Purpose                                                                                                                      |
|---------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| `/link self`                    | Starts the normal self-link flow for the Discord user who runs the command.                                                  |
| `/link force user display-name` | Lets a server admin manually link a Discord user to an Among Us display name. Useful if the normal flow cannot be completed. |
| `/link reset [user]`            | Unlinks your own account, or another user's (requires Manage Server).                                                        |
| `/testconnection`               | Checks whether the Discord bot can reach the Among Us plugin. Useful while setting up or debugging the integration.          |
| `/setup`                        | Opens the private settings panel for this server (requires Manage Server). See [Server setup](#6-server-setup).             |

### About the link data

- Links are stored in `DiscordBot/data/linking.sqlite`. An existing file from an earlier version keeps working.
- You normally do not need to touch it by hand.
- If a player changes their Among Us name, they should run `/link self` again or an admin can use `/link force`.

## 4. Optional mod integration

DiscordMute also integrates with supported host mods when they are installed:

- `Town Of Host Enhanced` or `Endless Host Roles` can provide more accurate player-name resolution.
- `Endless Host Roles` additionally enables Blackmailer support. When an EHR Blackmailer silences a player during a meeting, DiscordMute treats that player like a muted/dead player for the Discord voice sync and keeps them muted instead of allowing them to speak normally in the meeting.

If EHR is not installed, DiscordMute still works normally; only EHR-specific Blackmailer support is disabled.

## 5. Features

- **Automatic mute sync**: players are muted and unmuted in Discord in step with the Among Us round state.
- **EHR Blackmailer support**: when installed alongside Endless Host Roles, a blackmailed player stays muted during meetings instead of being able to speak.
- **Host mod integration**: Town Of Host Enhanced and Endless Host Roles improve player-name resolution when present.
- **Self-service linking**: players link their Discord account to their Among Us name in-game with a one-time Free Chat phrase or, if Free Chat isn't available, a pair of Quick Chat phrases — no manual admin setup required.
- **Crash-safe mutes**: the bot unmutes the players it muted after a crash or restart and only lifts mutes it applied itself.
- **Log bridging**: optionally forward plugin/BepInEx logs to the bot console for easier debugging.

## 6. Server setup

Server admins (Manage Server permission) configure the bot per server with `/setup`. It covers:

- a **log channel** for plugin, game, link and settings events
- a self-updating **link overview** message with Link/Unlink buttons
- a live **status message** (phase, players, spoiler lobby code) and a **match summary** after each game
- **voice rules** per phase for living and dead players (free, mute, deafen), delays of up to 5 seconds, and handling of members who are not playing
- optional **ghost chat** (dead players talk while the living are deafened; it can leak information if a deafen fails)
- **nickname sync** and **automatic relink** after an Among Us rename

The bot needs the **Mute Members**, **Deafen Members** and **Manage Nicknames** permissions, plus View Channel, Send Messages and Manage Messages in the channels you pick, and its role must sit above the roles of your players.

Update **both** the bot and the plugin: the player list, deaths and match results come from the new plugin version, and an older plugin keeps working with reduced features.

Details for every setting are in the [setup panel](docs/content/6.server-setup/1.setup-panel.md) and [game features](docs/content/6.server-setup/2.game-features.md) pages.

## 7. Telemetry

DiscordMute sends a small anonymous usage packet by default. Please leave it on: these few numbers are the only way I can see how DiscordMute is really used, which versions are still out there and where it needs to get better. It is a counter, not a tracker.

What is sent, every 5 minutes, to `mute.yonn2222.com`:

- A random instance id, generated once on first start and stored in the bot database. It is not derived from anything about you or your machine.
- A random id for each packet and a schema version.
- Whether the bot runs self-hosted or hosted.
- The bot version, plus how many connected plugins run each plugin version and each Among Us version.
- Counts: linked users, active games, servers the bot is in and connected plugins.
- Counts since the last packet: games muted, mutes, unmutes, Discord rate limit hits, and lobbies, game starts, meeting starts and meeting ends reported by plugins.
- Mute latency: the average in milliseconds and how many samples it is based on.
- For each optional feature, how many servers have it enabled (a number only, never which servers).

Never sent: Discord IDs, server or channel names, player names, IP addresses, secrets, or hashes of any of these. The packet format is strict, so the server refuses anything beyond the fields above. Like any web request, the connection reaches the server from your IP address. It is used only for rate limiting at the edge and is not stored with the packet data.

Telemetry is only active in the compiled `bot.exe` from a release. It is off when you run from source (`bun run dev`) unless you set the environment variable `DISCORDMUTE_TELEMETRY=1`.

To turn it off, add this to the bot `config.json`:

```json
"disableTelemetry": true
```

The key is not in `config.example.json` on purpose. See [docs/content/2.configuration/1.bot-config.md](docs/content/2.configuration/1.bot-config.md).

## 8. Update check

The bot and the plugin look up the latest release with one request to the GitHub API (`api.github.com/repos/YONN2222/AmongUs-DiscordMute/releases/latest`). No data about you is sent, only the usual request headers (GitHub sees the request like any other web request) including a `User-Agent` with the DiscordMute version. The bot logs a notice when a newer release exists (at start and then daily). The plugin checks once per game launch, when you become lobby host, and shows a one-time notice in lobby chat.

Turn it off with `"disableUpdateCheck": true` in the bot `config.json` and, separately, in the plugin `config.json`.

<details>
<summary><h2 style="display:inline;">9. Technical details</h2></summary>

### Tech Stack

| Component    | Stack                                                                                 |
|--------------|---------------------------------------------------------------------------------------|
| `DLL`        | C# (.NET 6) + [BepInEx](https://github.com/BepInEx/BepInEx) IL2CPP plugin             |
| `DiscordBot` | [Bun](https://bun.sh/) + TypeScript + [discord.js](https://discord.js.org/) + WebSocket |

The bot runs as a gateway process plus one or more cluster processes. The plugin connects to the gateway over one WebSocket (the secret is sent in the handshake, not in URLs).

The bot is distributed as a compiled `bot.exe` (via `bun build --compile`), so end users don't need Bun or Node.js installed to run a release build.

### Repository Structure

```text
AmongUs-DiscordMute/
├── DLL/            # C# / BepInEx Among Us plugin
├── DiscordBot/     # Bun + TypeScript Discord bot
├── assets/         # Logos and images
└── update.example.ps1
```

</details>

---

<div align="center">
  <sub>Licensed under <a href="LICENSE">GPLv3</a>.</sub>
</div>
