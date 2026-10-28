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

## 2. Installation

### 2.1 Install BepInEx

DiscordMute requires BepInEx.

- If you already use another Among Us mod that ships with BepInEx, you can usually skip this step.
- Otherwise, download the correct BepInEx build for your Among Us version:
  - Steam: [`BepInEx-Unity.IL2CPP-win-x86-6.0.0-be.735+5fef357.zip`](https://builds.bepinex.dev/projects/bepinex_be/735/BepInEx-Unity.IL2CPP-win-x86-6.0.0-be.735%2B5fef357.zip)
  - Microsoft Store / Epic Games: [`BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.735+5fef357.zip`](https://builds.bepinex.dev/projects/bepinex_be/735/BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.735%2B5fef357.zip)
- Extract it into your Among Us folder first.

If the Steam version does not start or cannot connect to Steam correctly, make sure Steam is open. Also check that your Among Us folder contains a file named `steam_appid.txt` with this content:

```text
945360
```

### 2.2 Install the DiscordMute plugin

1. Open your Among Us folder.
2. Go to `BepInEx/plugins`.
3. Copy `DiscordMute.dll` into that folder.
4. Start Among Us once.
5. Close Among Us again.

After the first launch, DiscordMute creates its own config folder inside BepInEx.

Example path:

```text
C:\Steam\steamapps\common\Among Us-Modded\BepInEx\DiscordMute
```

Open `config.json` in that folder and configure it.

#### Plugin config

| Field                    | Meaning                                                                                                                     |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `ip`                     | IP address of the machine running the Discord bot. Use `localhost` when the bot runs on the same PC.                        |
| `botPort`                | Port used by the Discord bot. Default: `7264`.                                                                              |
| `secret`                 | Shared secret used by the plugin and the bot. Set the same value in both configs.                                           |
| `exe`                    | Full path to the bot start file. This should point to `start.bat` inside the `DiscordBot` folder from the downloaded ZIP.   |
| `bridgeLogsToBotConsole` | When `true`, forwards all plugin/BepInEx logs to the bot console. Own DiscordMute warnings and errors are always forwarded. |

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

> [!IMPORTANT]
> **Update the plugin and the bot together.** The two only talk over a single WebSocket connection. The bot rejects an older plugin with an "outdated" message, and a new plugin simply can't connect to an older bot, so always update both.

> [!IMPORTANT]
> **Use double backslashes (`\\`) or forward slashes (`/`) in the `exe` path.**
> In JSON a single backslash is an escape character, so `"C:\Users\Me\start.bat"` makes the whole file invalid.
> The plugin then silently falls back to its default values (including the secret `change-me`), and the connection
> to the bot is rejected, even if your secrets are identical. The bot console shows a hint and `BepInEx/LogOutput.log` contains "Bot rejected the secret".
>
> | Correct                              | Wrong                              |
> |--------------------------------------|------------------------------------|
> | `"C:\\Users\\Me\\DiscordBot\\start.bat"` | `"C:\Users\Me\DiscordBot\start.bat"` |
> | `"C:/Users/Me/DiscordBot/start.bat"`     |                                    |
>
> If something doesn't work, check `BepInEx/LogOutput.log` for `Failed to read plugin config`.

### 2.3 Discord bot setup

1. Open the `DiscordBot` folder from the downloaded ZIP.
2. Rename `config.example.json` to `config.json`.
3. Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
4. Fill in the bot config.

#### Bot config

| Field             | Meaning                                                                                            |
|-------------------|----------------------------------------------------------------------------------------------------|
| `token`           | Bot token from the Discord Developer Portal.                                                       |
| `clientId`        | Application / client ID of your Discord bot.                                                       |
| `guildId`         | ID of the Discord server where the bot should be used.                                             |
| `channelIds`      | Optional. Fallback voice channels, used only when the bot can't tell which channel the host is in. |
| `secret`          | Must be exactly the same shared secret as in the plugin config.                                    |
| `botIp`           | IP address the bot binds to. Default: `0.0.0.0` (all interfaces).                                  |
| `botPort`         | Port used by the Discord bot. Default: `7264`.                                                     |
| `databaseDialect` | Storage backend for links: `sqlite` (default) or `postgres`.                                       |
| `databaseUrl`     | Optional. Connection URL, required when `databaseDialect` is `postgres`.                           |
| `sqlitePath`      | Optional. Location of the SQLite file. Default: `./data/linking.sqlite`.                           |
| `clusters`        | Optional. `{ "total": 1, "shardsPerCluster": 1 }`. The defaults suit a single server.              |

Example:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "clientId": "YOUR_CLIENT_ID",
  "guildId": "YOUR_GUILD_ID",
  "channelIds": ["CHANNEL_ID_1"],
  "secret": "replace-this-with-your-own-secret",
  "botIp": "localhost",
  "botPort": 7264,
  "databaseDialect": "sqlite"
}
```

### 2.4 First start

Once both configs are set up:

1. Start Among Us.
2. Create a lobby as host (online or LAN, not Freeplay). The plugin does nothing when you are not the host.
3. The Discord bot should start automatically through the `exe` path configured in the plugin.
4. Link your account with `/link self` (see below) and join a Discord voice channel.

DiscordMute mutes the voice channel the lobby host is sitting in, so the host must be linked. If the host can't be resolved, the bot falls back to the channels in `channelIds`. The bot keeps a record of the players it muted and unmutes them again after a crash or restart. It only lifts mutes it applied itself and leaves mutes that were already in place alone.

You can check that the bot is running with `GET /health` on the bot's port.

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

<details>
<summary><h2 style="display:inline;">6. Technical details</h2></summary>

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
