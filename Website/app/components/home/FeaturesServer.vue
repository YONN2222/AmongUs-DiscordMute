<script setup lang="ts">
const LIVE_STATUS_FIELDS = [
  { label: 'Phase', value: 'Tasks' },
  { label: 'Host', value: 'rhea' },
  { label: 'Players', value: '8' },
]

const MATCH_SUMMARY_FIELDS = [
  { label: 'Reason', value: 'All tasks done' },
  { label: 'Duration', value: '14 min' },
  { label: 'Winners', value: 'rhea, milo.exe, Ava' },
]

const SETUP_ROWS = [
  { label: 'Ghost chat', on: true },
  { label: 'Nickname sync', on: false },
  { label: 'Unmute delay', value: '2 s' },
  { label: 'Language', value: 'English' },
]

const LINKS = [
  { name: 'rhea', amongUsName: 'Red Rhea', linked: true },
  { name: 'milo.exe', amongUsName: 'milo', linked: true },
  { name: 'Ava', linked: false },
]

const LOG_LINES = [
  { time: '21:00', text: 'Mod connected' },
  { time: '21:02', text: 'Game started, 8 players' },
  { time: '21:03', text: 'Ava linked', tone: 'ok' },
  { time: '21:10', text: 'Ghost chat turned on' },
  { time: '21:12', text: 'Could not mute Jun', tone: 'warn' },
]

const HOSTING_OPTIONS = [
  { icon: 'i-lucide-server', title: 'Your own bot', text: 'Run bot.exe yourself' },
  { icon: 'i-lucide-cloud', title: 'Hosted bot', text: 'Use one someone runs for you' },
]

const CARD_UI = { container: 'h-full', wrapper: 'h-full', footer: 'w-full pt-5' }
</script>

<template>
  <div class="bento">
    <UPageCard v-reveal variant="soft" title="Live status and match summary" class="wide" :ui="CARD_UI">
      <template #description>
        Phase, host and players while a game runs, with the lobby code behind a spoiler. After each game: why it ended,
        the winners, the duration and every player.
      </template>
      <template #footer>
        <div class="proof messages" role="img" aria-label="Example: a live status message with a hidden lobby code, and a match summary after the game">
          <div class="embed live">
            <p class="embed-title"><UIcon name="i-lucide-radio" class="embed-icon pulse" />Game running</p>
            <dl class="fields">
              <div v-for="f in LIVE_STATUS_FIELDS" :key="f.label"><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></div>
              <div><dt>Lobby code</dt><dd><span class="spoiler">QWERTY</span></dd></div>
            </dl>
          </div>
          <div class="embed done">
            <p class="embed-title"><UIcon name="i-lucide-trophy" class="embed-icon" />Crewmates win</p>
            <dl class="fields">
              <div v-for="f in MATCH_SUMMARY_FIELDS" :key="f.label"><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></div>
            </dl>
          </div>
        </div>
      </template>
    </UPageCard>

    <UPageCard v-reveal="90" variant="soft" title="/setup panel" :ui="CARD_UI">
      <template #description>Every setting in one private panel for admins, in English and German.</template>
      <template #footer>
        <div class="proof setup" role="img" aria-label="Example: the voice page of the setup panel with switches and a page switcher">
          <span v-for="r in SETUP_ROWS" :key="r.label" class="setup-row">
            {{ r.label }}
            <span v-if="r.value" class="setup-value">{{ r.value }}</span>
            <span v-else class="toggle" :class="{ on: r.on }" />
          </span>
          <span class="pager">
            <span class="pager-btn"><UIcon name="i-lucide-chevron-left" class="pager-icon" /></span>
            <span>Voice <b>2 / 5</b></span>
            <span class="pager-btn"><UIcon name="i-lucide-chevron-right" class="pager-icon" /></span>
          </span>
        </div>
      </template>
    </UPageCard>

    <UPageCard v-reveal variant="soft" title="Link overview" :ui="CARD_UI">
      <template #description>A self-updating list with Link and Unlink buttons, a paged view and extra controls for admins.</template>
      <template #footer>
        <div class="proof links" role="img" aria-label="Example: the link overview with two linked players and one Link button">
          <span v-for="l in LINKS" :key="l.name" class="link-row">
            <span class="link-name">{{ l.name }}<small v-if="l.linked">{{ l.amongUsName }}</small></span>
            <span class="btn" :class="l.linked ? 'unlink' : 'link'">{{ l.linked ? 'Unlink' : 'Link' }}</span>
          </span>
        </div>
      </template>
    </UPageCard>

    <UPageCard v-reveal="90" variant="soft" title="Log channel" :ui="CARD_UI">
      <template #description>Connections, games, links, setting changes and mute problems in one place.</template>
      <template #footer>
        <div class="proof log" role="img" aria-label="Example: log channel entries">
          <span v-for="line in LOG_LINES" :key="line.time + line.text" :class="line.tone"><b>{{ line.time }}</b>{{ line.text }}</span>
        </div>
      </template>
    </UPageCard>

    <UPageCard v-reveal variant="soft" title="Self-host or hosted" :ui="CARD_UI">
      <template #description>The plugin works with your own bot or a hosted one. The setup guide below covers both.</template>
      <template #footer>
        <div class="proof hosting" role="img" aria-label="Two ways to run the bot: your own or a hosted one">
          <span v-for="o in HOSTING_OPTIONS" :key="o.title" class="option">
            <UIcon :name="o.icon" class="option-icon" />
            <span><b>{{ o.title }}</b><small>{{ o.text }}</small></span>
          </span>
        </div>
      </template>
    </UPageCard>
  </div>
</template>

<style scoped src="./bento.css"></style>

<style scoped>
.messages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.embed { border-radius: 8px; background: var(--surface); border-left: 3px solid var(--accent); padding: 12px 14px; min-width: 0; }
.embed.done { border-left-color: var(--talk); }
.embed-title { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-weight: 600; color: var(--text); }
.embed-icon { width: 16px; height: 16px; color: var(--accent-text); }
.done .embed-icon { color: var(--talk); }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; margin: 0; }
.fields dt { color: var(--dim); font-size: 12px; }
.fields dd { margin: 0; color: var(--text); font-size: 13px; overflow-wrap: anywhere; }
.done .fields div:last-child { grid-column: 1 / -1; }
.spoiler { display: inline-block; padding: 0 6px; border-radius: 4px; background: #3a3a46; color: transparent; letter-spacing: .1em; user-select: none; }

.setup { display: grid; gap: 4px; }
.setup-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 4px; color: var(--muted); font-size: 13px; }
.setup-value { color: var(--text); padding: 2px 8px; border-radius: 6px; background: var(--surface-2); }
.toggle { position: relative; width: 30px; height: 18px; border-radius: 9px; background: var(--surface-2); border: 1px solid var(--line); flex: none; }
.toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--dim); }
.toggle.on { background: var(--accent); border-color: var(--accent); }
.toggle.on::after { left: 14px; background: #fff; }
.pager { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--dim); font-size: 13px; }
.pager b { color: var(--text); font-weight: 500; }
.pager-btn { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; background: var(--surface-2); }
.pager-icon { width: 14px; height: 14px; color: var(--text); }

.links { display: grid; gap: 8px; }
.link-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.link-name { display: grid; min-width: 0; color: var(--text); }
.link-name small { color: var(--dim); font-size: 12px; }
.btn { flex: none; padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; }
.btn.link { background: var(--accent); color: #fff; }
.btn.unlink { background: var(--surface-2); color: var(--text); }

.hosting { display: grid; gap: 8px; }
.option { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; background: var(--surface); }
.option-icon { width: 18px; height: 18px; color: var(--accent-text); flex: none; }
.option b { display: block; font-weight: 500; color: var(--text); font-size: 14px; }
.option small { color: var(--dim); font-size: 12px; }

.pulse { animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .4; } }

@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none; }
}

@media (max-width: 560px) {
  .messages { grid-template-columns: minmax(0, 1fr); }
}
</style>
