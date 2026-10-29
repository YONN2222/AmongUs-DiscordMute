export type FaqEntry = { id: string; question: string; answer: string }

export const FAQ: readonly FaqEntry[] = [
  {
    id: 'platforms',
    question: 'Which platforms are supported?',
    answer:
      'Only the host needs the mod, and the host plays on Windows: Steam, Epic Games or the Microsoft Store, all with the 64-bit BepInEx build. itch.io builds are still 32-bit and are not supported. The other players can join from any platform, they only need a linked Discord account.',
  },
  {
    id: 'install',
    question: 'What do I need to install?',
    answer:
      'The host installs BepInEx and puts DiscordMute.dll into BepInEx/plugins. When you self-host, you also run the Discord bot from the release download. It ships as a compiled bot.exe, so you do not need Bun or Node.js. Nobody else installs anything.',
  },
  {
    id: 'linking',
    question: 'How do players link their Discord account?',
    answer:
      'Each player runs /link self in Discord and gets a one-time code. They send it in the lobby chat: the text code in free chat, or two quick chat phrases if their account can only use quick chat. The mod catches the code before it shows up in chat and the account is linked. Codes expire after 5 minutes.',
  },
  {
    id: 'muting',
    question: 'When does it mute and unmute?',
    answer:
      'Everyone can talk in the lobby. When the round starts, every linked player in the voice channel the host is in gets muted. In meetings the living can talk, and dead players stay muted until the game ends. When the game ends or the connection to the mod drops, the bot unmutes everyone it muted, and after a crash or restart it does the same. Mutes it did not set itself are left alone.',
  },
  {
    id: 'permissions',
    question: 'What permissions does the bot need?',
    answer:
      'Mute Members and Deafen Members, so it can server-mute, server-deafen (ghost chat) and unmute players, and Manage Nicknames if you use nickname sync. It must be able to see the voice channel you play in, and needs View Channel and Send Messages in the channel where you want the log. The link overview is sent as a reply to your command, so it needs no extra permission. Add it to your server with the bot and applications.commands scopes so the slash commands show up.',
  },
  {
    id: 'telemetry',
    question: 'What data does it send, and how do I turn that off?',
    answer:
      'The bot sends anonymous totals every few minutes: a random instance id, whether it is self-hosted or hosted, the bot, mod and Among Us versions, and counters such as games muted and linked users. It never sends Discord IDs, server or channel names, player names, secrets, or hashes of them. To turn it off, set disableTelemetry: true in the bot config.json.',
  },
  {
    id: 'cost',
    question: 'Is it free and open source?',
    answer: 'Yes. DiscordMute is free and open source under GPLv3. The mod, the bot and this website live in one public GitHub repository.',
  },
  {
    id: 'affiliation',
    question: 'Is this an official Among Us product?',
    answer: 'No. DiscordMute is a fan-made project and is not affiliated with or endorsed by Innersloth.',
  },
]
