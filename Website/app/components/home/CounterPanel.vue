<script setup lang="ts">
import { COUNTER_KEYS, PUBLIC_COUNTERS, type CounterKey, type ModeCount } from '#shared/counters'

const COUNTERS: Record<CounterKey, { label: string; icon: string }> = {
  gamesMuted: { label: 'Games muted', icon: 'i-lucide-mic-off' },
  uniqueUsers: { label: 'Players linked', icon: 'i-lucide-users' },
  activeGames: { label: 'Games running now', icon: 'i-lucide-gamepad-2' },
  guilds: { label: 'Servers', icon: 'i-lucide-hash' },
}
const EMPTY: ModeCount = { total: 0, selfHost: 0, hosted: 0 }

const { stats, unavailable } = usePublicStats()
const hosted = useHostedView()
const hostedOpen = computed(() => hosted.value.status === 'available')

const readouts = computed(() => {
  const current = stats.value
  if (unavailable.value || !current) {
    return COUNTER_KEYS.filter((key) => PUBLIC_COUNTERS[key]).map((key) => ({ key, ...COUNTERS[key], count: EMPTY }))
  }
  return COUNTER_KEYS.flatMap((key) => {
    const count = current[key]
    return count ? [{ key, ...COUNTERS[key], count }] : []
  })
})
</script>

<template>
  <SiteSection id="stats" title="Rounds kept quiet">
    <template #description>Totals from self-hosted and hosted bots.</template>
    <div class="panel">
      <div class="stats" :class="{ veiled: unavailable }" :aria-hidden="unavailable || undefined">
        <div v-for="(r, index) in readouts" :key="r.key" v-reveal="index * 90">
          <UCard variant="soft" as="article" class="h-full">
            <h3 class="stat-label"><UIcon :name="r.icon" class="stat-icon" />{{ r.label }}</h3>
            <HomeCountUp class="stat-num" :value="r.count.total" />
            <dl class="split">
              <div>
                <dt><UIcon name="i-lucide-server" class="split-icon" />Self-hosted</dt>
                <dd><HomeCountUp :value="r.count.selfHost" /></dd>
              </div>
              <div>
                <dt><UIcon name="i-lucide-cloud" class="split-icon" />Hosted</dt>
                <dd>
                  <HomeCountUp :class="{ soon: !hostedOpen }" :value="r.count.hosted" />
                  <UBadge v-if="!hostedOpen" color="neutral" variant="soft" :label="hosted.badge" />
                </dd>
              </div>
            </dl>
          </UCard>
        </div>
      </div>
      <UAlert
        v-if="unavailable"
        class="unavailable"
        role="status"
        color="neutral"
        variant="outline"
        icon="i-lucide-radio-tower"
        title="Live numbers unavailable right now."
        :ui="{ root: 'items-center justify-center', wrapper: 'flex-none', title: 'text-[17px] font-normal text-muted', icon: 'text-dimmed' }"
      />
    </div>
    <p class="note"><UIcon name="i-lucide-info" class="note-icon" />Anonymous totals from bots with telemetry turned on.</p>
  </SiteSection>
</template>

<style scoped>
.panel { position: relative; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 16px; }
.stats.veiled { visibility: hidden; }
.stat-label { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--muted); font-size: 16px; font-weight: 500; }
.stat-icon { width: 20px; height: 20px; color: var(--accent-text); }
.stat-num { display: block; font-size: 72px; font-weight: 600; line-height: 1; margin: 18px 0 28px; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.split { display: grid; grid-template-columns: 1fr 1fr; margin: 0; border-top: 1px solid var(--line); }
.split > div { padding-top: 18px; }
.split > div + div { border-left: 1px solid var(--line); padding-left: 20px; }
.split dt { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
.split-icon { width: 16px; height: 16px; }
.split dd { margin: 6px 0 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.soon { color: var(--dim); }
.unavailable { position: absolute; inset: 0; border-radius: var(--radius-card); background: var(--surface); }
.note { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 24px 0 0; color: var(--dim); font-size: 14px; text-align: center; }
.note-icon { width: 16px; height: 16px; flex: none; }

@media (max-width: 760px) {
  .stat-num { font-size: 56px; }
}

@media (max-width: 400px) {
  .stat-num { font-size: 48px; }
  .split dd { font-size: 20px; }
  .split > div + div { padding-left: 14px; }
}
</style>
