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

DiscordMute keeps your Discord voice channel in sync with your Among Us game. Everyone is muted while tasks are running, living players are unmuted in meetings, and dead players stay muted.

I built it because my friend group kept talking during live rounds and nobody wanted to mute themselves every game. It has two parts: a small plugin for Among Us and a Discord bot. You can use the hosted bot, or run the bot yourself.

> [!IMPORTANT]
> **Only the host needs the plugin.** DiscordMute works only while you are the host of the lobby (online or LAN). Other players play the normal game and only have to be linked in Discord. If you join someone else's lobby, the plugin does nothing.

## What it can do

- **Automatic muting** for every phase, with your own rules for living and dead players and optional delays.
- **Easy linking**: players link their Discord account with a one-time phrase in the lobby chat, or with Quick Chat on guest accounts.
- **Setup in Discord**: one `/setup` panel for every server setting, no config files.
- **Link overview** with buttons, so players can link and unlink without typing commands.
- **Live status** of the running game and a **match summary** with winners after every game.
- **Ghost chat**: dead players can talk while the living are deafened.
- **Nickname sync**, **automatic relink** after a name change and a **log channel** for admins.
- **Crash safe**: after a crash or restart the bot lifts every mute it set.
- **EHR support**: blackmailed players stay muted in meetings.
- English and German.

## Quick start

The hosted bot is the easy way. There is nothing to run on your PC besides the game.

1. Add the bot to your server with the **Add the bot** button on [mute.yonn2222.com](https://mute.yonn2222.com).
2. In Discord, run `/setup`, open the **General** page and press **Create secret**. Copy it, it is only shown once.
3. Install [BepInEx and `DiscordMute.dll`](https://docs.mute.yonn2222.com/getting-started/self-host-setup) in your Among Us folder (Steam, x64).
4. Start Among Us once, then open `BepInEx/DiscordMute/config.json` and set:

   ```json
   {
     "mode": "hosted",
     "secret": "dmh_your-secret"
   }
   ```

5. Host a lobby, join a voice channel and run `/link self`. Send the phrase the bot gives you in the lobby chat, and you are linked.

Full guide: [hosted setup](https://docs.mute.yonn2222.com/getting-started/hosted-setup).

## Self-hosting

Want full control? Run the bot on your own PC. This takes a few more steps.

1. Download the latest release from [GitHub](https://github.com/YONN2222/AmongUs-DiscordMute/releases) and install the plugin as above.
2. Create a bot in the Discord Developer Portal and put its `token` and `clientId` into `DiscordBot/config.json`.
3. Start the bot, then run `/setup` in Discord and create your secret.
4. In the plugin `config.json`, set `ip`, `botPort` and `secret`.
5. Host a lobby and link yourself with `/link self`.

Details are in the [self-host guide](https://docs.mute.yonn2222.com/getting-started/self-host-setup).

Keep the plugin and the bot on the same major version. 2.x and 3.x do not work together.

## Telemetry

DiscordMute sends anonymous usage counts, such as how many games ran and which versions are in use. This helps me see what to improve. It never includes Discord IDs, names or IP addresses, and self-hosters can switch it off. See the [privacy docs](https://docs.mute.yonn2222.com/privacy/telemetry) for exactly what is sent.

## Links

- Website: [mute.yonn2222.com](https://mute.yonn2222.com)
- Documentation: [docs.mute.yonn2222.com](https://docs.mute.yonn2222.com)
- Problems or ideas: [open an issue](https://github.com/YONN2222/AmongUs-DiscordMute/issues)

## License

[GPLv3](LICENSE)
