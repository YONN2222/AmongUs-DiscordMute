<script setup lang="ts">
const METRIC_LINES = [
  { name: 'discordmute_guilds', value: '42' },
  { name: 'discordmute_mutes_total{action="mute"}', value: '1873' },
  { name: 'discordmute_mutes_total{action="unmute"}', value: '1869' },
  { name: 'discordmute_mute_failures_total', value: '3' },
]

const SMALL_FEATURES = [
  { icon: 'i-lucide-braces', title: 'JSON logs', description: 'Structured log output for your log tooling.' },
  { icon: 'i-lucide-bell-ring', title: 'Update check', description: 'A notice when a new release is out. One switch turns it off.' },
  { icon: 'i-lucide-bar-chart-3', title: 'Anonymous telemetry', description: 'Counters only, no IDs or names. One switch turns it off.' },
]

const CARD_UI = { container: 'h-full', wrapper: 'h-full', footer: 'w-full pt-5' }
</script>

<template>
  <div class="bento">
    <UPageCard v-reveal variant="soft" title="Prometheus metrics" class="wide" :ui="CARD_UI">
      <template #description>An optional /metrics endpoint for Prometheus and Grafana, off by default.</template>
      <template #footer>
        <div class="proof terminal" role="img" aria-label="Example output of the metrics endpoint">
          <span class="prompt"><span class="dim">$</span> curl localhost/metrics</span>
          <span v-for="m in METRIC_LINES" :key="m.name" class="metric">
            <span class="metric-name">{{ m.name }}</span><span class="metric-value">{{ m.value }}</span>
          </span>
        </div>
      </template>
    </UPageCard>

    <div v-reveal="90" class="stack">
      <UPageFeature v-for="f in SMALL_FEATURES" :key="f.title" :icon="f.icon" :title="f.title" :description="f.description" orientation="horizontal" class="small" />
    </div>
  </div>
</template>

<style scoped src="./bento.css"></style>

<style scoped>
.terminal { display: grid; gap: 8px; font-family: var(--font-mono); font-size: 13px; color: var(--muted); }
.prompt { color: var(--text); }
.dim { color: var(--dim); }
.metric { display: flex; justify-content: space-between; gap: 16px; min-width: 0; }
.metric-name { min-width: 0; overflow-wrap: anywhere; }
.metric-value { color: var(--talk); font-variant-numeric: tabular-nums; }
.stack .small { padding: 18px 22px; }
</style>
