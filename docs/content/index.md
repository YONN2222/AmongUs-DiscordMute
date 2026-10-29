---
seo:
  title: DiscordMute documentation
  description: Set up and run DiscordMute, an Among Us plugin and Discord bot that mutes your voice channel during rounds and unmutes the living in meetings.
---

::u-page-hero
#title
Mute Discord automatically while you play Among Us

#description
DiscordMute mutes your Discord voice channel during tasks, unmutes the living players in meetings and keeps the dead muted. Run it yourself or use the hosted bot.

#links
  :::u-button
  ---
  color: neutral
  size: xl
  to: /getting-started/self-host-setup
  trailing-icon: i-lucide-arrow-right
  ---
  Set up DiscordMute
  :::

  :::u-button
  ---
  color: neutral
  icon: i-simple-icons-github
  size: xl
  to: https://github.com/YONN2222/AmongUs-DiscordMute
  variant: outline
  ---
  View on GitHub
  :::
::

::u-page-section
#title
How DiscordMute works

#features
  :::u-page-feature
  ---
  icon: i-lucide-mic-off
  ---
  #title
  Auto-mute during tasks

  #description
  When a round starts, everyone in the lobby host's voice channel is muted so nobody talks over live gameplay.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-users
  ---
  #title
  Meetings unmute the living

  #description
  Living players can talk in meetings. Dead players stay muted so they cannot give anything away.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-link
  ---
  #title
  Link with a code or quick chat

  #description
  Run `/link self` and send the one-time phrase in Among Us chat. Free Chat and the Quick Chat fallback both work.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-server
  ---
  #title
  Self-host it

  #description
  Install the plugin and run your own Discord bot. Everything stays on your PC.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-cloud
  ---
  #title
  Hosted option planned

  #description
  Invite a hosted bot to your server and skip running anything yourself. This is not available yet.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-activity
  ---
  #title
  Monitor and stay in control

  #description
  Optional Prometheus metrics and JSON logs, plus a clear and opt-out telemetry and update check.
  :::
::
