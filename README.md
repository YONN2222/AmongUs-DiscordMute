<div align="center">
  <img src="assets/AmongUsDiscordMuteLarge.png" alt="DiscordMute" width="600" />

  <p><strong>Automatic Discord voice muting for Among Us.</strong></p>
</div>

<br />

DiscordMute keeps your Discord voice channel in sync with your Among Us game. Everyone is muted while tasks are running, living players are unmuted in meetings, and dead players stay muted.

It has two parts: a small plugin for Among Us and a Discord bot. You can use the hosted bot, or run the bot yourself.

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
