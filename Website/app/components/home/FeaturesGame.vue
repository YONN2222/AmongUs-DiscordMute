<script setup lang="ts">
type VoiceState = 'free' | 'muted' | 'deafened'

const STATE_LOOK: Record<VoiceState, { icon: string; label: string }> = {
  free: { icon: 'i-lucide-mic', label: 'Free' },
  muted: { icon: 'i-lucide-mic-off', label: 'Muted' },
  deafened: { icon: 'i-lucide-headphone-off', label: 'Deafened' },
}

const PHASES = ['Lobby', 'Tasks', 'Meeting']
const PHASE_RULES: { who: string; states: VoiceState[] }[] = [
  { who: 'Living', states: ['free', 'muted', 'free'] },
  { who: 'Dead', states: ['free', 'muted', 'muted'] },
]
const PHASE_DELAYS = ['0 s', '0 s', '2 s']

const GHOST_CHAT_PLAYERS = [
  { name: 'rhea', dead: true },
  { name: 'Jun', dead: true },
  { name: 'milo.exe', dead: false },
  { name: 'Ava', dead: false },
]

const PARALLEL_GAMES = [
  { channel: 'Among Us night', host: 'rhea', muted: 6 },
  { channel: 'Late lobby', host: 'Jun', muted: 9 },
]

const SMALL_FEATURES = [
  { icon: 'i-lucide-user-round-x', title: 'Spectators and bystanders', description: 'Members in voice who are not playing are left alone, muted or treated like dead players.' },
  { icon: 'i-lucide-refresh-cw', title: 'Automatic relink', description: 'Players are matched by friend code, so renaming in Among Us keeps the link.' },
  { icon: 'i-lucide-id-card', title: 'Nickname sync', description: 'Optional. Players get their Among Us name as nickname during the game, restored afterwards.' },
]

const CARD_UI = { container: 'h-full', wrapper: 'h-full', footer: 'w-full pt-5' }
</script>

<template>
  <div class="bento">
    <UPageCard v-reveal variant="soft" title="Mute by round phase" class="wide" :ui="CARD_UI">
      <template #description>
        Muted during tasks. Meetings unmute the living, the dead stay muted. Each phase can be free, muted or deafened,
        with a delay of up to 5 seconds.
      </template>
      <template #footer>
        <div class="proof phases" role="img" aria-label="Example: living players are muted during tasks and free in meetings, dead players stay muted, meetings unmute after 2 seconds">
          <span />
          <span v-for="p in PHASES" :key="p" class="phase-name">{{ p }}</span>
          <template v-for="rule in PHASE_RULES" :key="rule.who">
            <span class="who">{{ rule.who }}</span>
            <span v-for="(state, i) in rule.states" :key="i" class="state" :class="state">
              <UIcon :name="STATE_LOOK[state].icon" class="state-icon" />{{ STATE_LOOK[state].label }}
            </span>
          </template>
          <span class="who delay-label">Delay</span>
          <span v-for="(d, i) in PHASE_DELAYS" :key="i" class="delay">{{ d }}</span>
        </div>
      </template>
    </UPageCard>

    <UPageCard v-reveal="90" variant="soft" title="Ghost chat" :ui="CARD_UI">
      <template #description>Optional. Dead players talk during tasks while the living are deafened.</template>
      <template #footer>
        <div class="proof ghosts" role="img" aria-label="Example: during tasks two dead players talk, two living players are deafened">
          <span v-for="p in GHOST_CHAT_PLAYERS" :key="p.name" class="ghost-row" :class="{ talking: p.dead }">
            <UIcon :name="p.dead ? 'i-lucide-ghost' : 'i-lucide-user-round'" class="ghost-icon" />
            <span class="ghost-name">{{ p.name }}</span>
            <span class="ghost-state">
              <UIcon :name="p.dead ? 'i-lucide-audio-lines' : 'i-lucide-headphone-off'" class="state-icon" />
              {{ p.dead ? 'Talking' : 'Deafened' }}
            </span>
          </span>
        </div>
      </template>
    </UPageCard>

    <UPageCard v-reveal variant="soft" title="Several games at once" class="wide half-on-tablet" :ui="CARD_UI">
      <template #description>Each game mutes the voice channel its host is in, so one server can run more than one.</template>
      <template #footer>
        <div class="games" role="img" aria-label="Example: two games run at the same time, each in the voice channel of its host">
          <div v-for="g in PARALLEL_GAMES" :key="g.channel" class="proof channel">
            <span class="ch on"><UIcon name="i-lucide-volume-2" class="ch-icon" /><span class="truncate">{{ g.channel }}</span></span>
            <span class="ch"><UIcon name="i-lucide-crown" class="ch-icon" />{{ g.host }}<UBadge color="primary" variant="soft" label="Host" class="ms-auto" /></span>
            <span class="ch"><UIcon name="i-lucide-mic-off" class="ch-icon" />{{ g.muted }} players muted</span>
          </div>
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
.phases { display: grid; grid-template-columns: auto repeat(3, minmax(0, 1fr)); gap: 8px; align-items: center; container-type: inline-size; }
.phase-name { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; text-align: center; }
.who { color: var(--muted); font-size: 13px; padding-right: 8px; }
.state { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; border-radius: 8px; font-size: 13px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); min-width: 0; }
.state-icon { width: 14px; height: 14px; flex: none; }
.state.free { color: var(--talk); background: rgba(74, 222, 128, .08); border-color: rgba(74, 222, 128, .22); }
.state.muted { color: var(--accent-text); background: rgba(220, 47, 53, .1); border-color: rgba(220, 47, 53, .28); }
.state.deafened { color: var(--warn); background: rgba(245, 181, 68, .08); border-color: rgba(245, 181, 68, .24); }
.delay-label { color: var(--dim); }
.delay { text-align: center; color: var(--dim); font-size: 13px; font-variant-numeric: tabular-nums; }

@container (max-width: 340px) {
  .state-icon { display: none; }
  .state { font-size: 12px; }
}

.ghosts { display: grid; gap: 6px; }
.ghost-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; color: var(--dim); }
.ghost-icon { width: 16px; height: 16px; flex: none; }
.ghost-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ghost-state { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 13px; color: var(--warn); }
.ghost-row.talking { background: rgba(74, 222, 128, .07); color: var(--text); }
.ghost-row.talking .ghost-icon { color: var(--indigo-text); }
.ghost-row.talking .ghost-state { color: var(--talk); }
.ghost-row.talking .ghost-state .state-icon { animation: talk 1.4s ease-in-out infinite; }

.games { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.games .proof { padding: 10px; }
.stack .small { padding: 18px 22px; }

@keyframes talk { 50% { opacity: .35; } }

@media (prefers-reduced-motion: reduce) {
  .ghost-row.talking .ghost-state .state-icon { animation: none; }
}

@media (max-width: 1023px) {
  .games { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 760px) {
  .games { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
}
</style>
