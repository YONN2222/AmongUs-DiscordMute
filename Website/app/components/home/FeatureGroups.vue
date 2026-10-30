<script setup lang="ts">
interface Feature { icon: string; title: string; description: string }

const GROUPS: { id: string; title: string; features: Feature[] }[] = [
  {
    id: 'game',
    title: 'In the game',
    features: [
      { icon: 'i-lucide-timer', title: 'Mute by round phase', description: 'Muted during tasks. Meetings unmute the living, the dead stay muted.' },
      { icon: 'i-lucide-sliders-horizontal', title: 'Voice rules and delays', description: 'Free, muted or deafened for each phase, with delays of up to 5 seconds.' },
      { icon: 'i-lucide-ghost', title: 'Ghost chat', description: 'Optional. Dead players talk during tasks while the living are deafened.' },
      { icon: 'i-lucide-user-round-x', title: 'Spectators and bystanders', description: 'Members in voice who are not playing are left alone, muted or treated like dead players.' },
      { icon: 'i-lucide-refresh-cw', title: 'Automatic relink', description: 'The bot matches players by friend code, so renaming in Among Us keeps the link.' },
      { icon: 'i-lucide-id-card', title: 'Nickname sync', description: 'Optional. Players get their Among Us name as nickname during the game, restored afterwards.' },
      { icon: 'i-lucide-gamepad-2', title: 'Several games at once', description: 'Each game mutes the voice channel its host is in, so one server can run more than one.' },
    ],
  },
  {
    id: 'server',
    title: 'For your server',
    features: [
      { icon: 'i-lucide-settings-2', title: '/setup panel', description: 'Every setting in one private panel for admins, in English and German.' },
      { icon: 'i-lucide-list-checks', title: 'Link overview', description: 'A self-updating list with Link and Unlink buttons, a paged view and extra controls for admins.' },
      { icon: 'i-lucide-scroll-text', title: 'Log channel', description: 'Connections, games, links, setting changes and mute problems in one place.' },
      { icon: 'i-lucide-radio', title: 'Live status', description: 'Phase, host and players while a game runs. The lobby code stays behind a spoiler.' },
      { icon: 'i-lucide-trophy', title: 'Match summary', description: 'After each game: why it ended, the winners, the duration and every player.' },
      { icon: 'i-lucide-cloud', title: 'Self-host or hosted', description: 'The plugin works with your own bot or a hosted one. The setup guide below covers both.' },
    ],
  },
  {
    id: 'operators',
    title: 'For operators',
    features: [
      { icon: 'i-lucide-activity', title: 'Prometheus metrics', description: 'An optional /metrics endpoint for Prometheus and Grafana, off by default.' },
      { icon: 'i-lucide-braces', title: 'JSON logs', description: 'Structured log output for your log tooling.' },
      { icon: 'i-lucide-bell-ring', title: 'Update check', description: 'A notice when a new release is out. One switch turns it off.' },
      { icon: 'i-lucide-bar-chart-3', title: 'Anonymous telemetry', description: 'Counters only, no IDs or names. One switch turns it off.' },
    ],
  },
]
</script>

<template>
  <div class="groups">
    <section v-for="g in GROUPS" :key="g.id" v-reveal :aria-labelledby="`feature-group-${g.id}`">
      <h3 :id="`feature-group-${g.id}`" class="group-title">{{ g.title }}</h3>
      <div class="group-grid">
        <UPageFeature v-for="f in g.features" :key="f.title" :icon="f.icon" :title="f.title" :description="f.description" orientation="vertical" class="feature" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.groups { display: grid; gap: 48px; margin-top: 56px; }
.group-title { margin: 0 0 20px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.group-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px 24px; }
.feature { min-width: 0; }

@media (max-width: 1023px) {
  .group-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 640px) {
  .groups { gap: 40px; margin-top: 40px; }
  .group-grid { grid-template-columns: minmax(0, 1fr); gap: 24px; }
}
</style>
