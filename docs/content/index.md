---
seo:
  title: DiscordMute documentation
  description: Set up and run DiscordMute, an Among Us plugin and Discord bot that mutes your voice channel during rounds and unmutes the living in meetings.
---

::u-page-hero
---
class: docs-hero
ui:
  title: font-semibold text-balance
---
#top
:space-canvas{:stars="260"}

#headline
  :::u-badge
  ---
  class: rounded-full
  icon: i-lucide-mic-off
  variant: subtle
  ---
  Among Us and Discord
  :::

#title
Nobody talks over the round. [DiscordMute handles it.]{.font-extrabold}

#description
DiscordMute mutes your Discord voice channel during tasks, unmutes the living in meetings and keeps the dead muted. Run it yourself or use the hosted bot.

#links
  :::u-button
  ---
  color: primary
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
  variant: ghost
  ---
  View on GitHub
  :::
::

::u-page-section
---
features:
  - title: Install the plugin
    description: Add BepInEx and DiscordMute.dll to your Among Us folder.
    icon: i-lucide-puzzle
    to: /getting-started/self-host-setup
  - title: Create your bot
    description: Fill in the bot config with your token and a shared secret.
    icon: i-lucide-bot
    to: /configuration/bot-config
  - title: Link your account
    description: Run /link self and send the phrase in Among Us chat.
    icon: i-lucide-link
    to: /commands/slash-commands
  - title: Host a lobby
    description: Join a voice channel and start a round. The rest is automatic.
    icon: i-lucide-gamepad-2
    to: /getting-started/introduction
---
#title
Up and running in four steps

#description
Pick the step you are on.
::

::u-page-section
#title
What DiscordMute does for your round

#description
No more hand muting, no more talking over live gameplay.

#body
  :::u-page-grid
    ::::u-page-card
    ---
    class: lg:col-span-2
    icon: i-lucide-mic-off
    spotlight: true
    title: Auto-mute during tasks
    description: When a round starts, everyone in the lobby host's voice channel is muted, so nobody talks over live gameplay.
    to: /getting-started/introduction
    ---
    ::::

    ::::u-page-card
    ---
    icon: i-lucide-users
    spotlight: true
    title: Meetings unmute the living
    description: Living players can talk in meetings. Dead players stay muted.
    to: /getting-started/introduction
    ---
    ::::

    ::::u-page-card
    ---
    icon: i-lucide-link
    spotlight: true
    title: Link by code or quick chat
    description: Send a one-time phrase in Free Chat, or use the Quick Chat fallback.
    to: /commands/slash-commands
    ---
    ::::

    ::::u-page-card
    ---
    icon: i-lucide-server
    spotlight: true
    title: Self-host or hosted
    description: Run your own bot on your PC. A hosted bot is planned.
    to: /getting-started/hosted-setup
    ---
    ::::

    ::::u-page-card
    ---
    icon: i-lucide-shield-check
    spotlight: true
    title: Clear about data
    description: See exactly what telemetry and the update check send, and how to turn them off.
    to: /privacy/telemetry
    ---
    ::::
  :::
::

::u-page-section
---
ui:
  container: py-24 sm:py-32
  title: font-semibold text-balance
---
#top
:space-canvas{:stars="90"}

#title
Something not working? [Check the FAQ.]{.font-extrabold}

#description
Most problems come down to a mismatched secret, a broken path in the config or a host who is not linked yet.

#links
  :::u-button
  ---
  color: primary
  size: xl
  to: /faq/faq
  trailing-icon: i-lucide-arrow-right
  ---
  Open the FAQ
  :::
::
