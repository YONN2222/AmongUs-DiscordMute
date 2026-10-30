<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

type Phase = 'lobby' | 'tasks' | 'meeting'
type Player = { name: string; au: string; color: string; host?: boolean; dies?: boolean; unlinked?: boolean }
type State = { kind: 'talk' | 'muted' | 'idle'; icon: string; label: string; dead: boolean }

const PLAYERS: readonly Player[] = [
  { name: 'Yonn', au: 'yonn', color: '#ff8f93', host: true },
  { name: 'Rhea', au: 'rhea', color: '#7c8cff' },
  { name: 'Milo', au: 'milo.exe', color: '#4ade80' },
  { name: 'Jun', au: 'junjun', color: '#f5c26b' },
  { name: 'Sasha', au: 'sash', color: '#b18cff' },
  { name: 'Theo', au: 'theo', color: '#4cc9e8', dies: true },
  { name: 'Ines', au: 'ines', color: '#f472b6', dies: true },
  { name: 'Kai', au: 'not linked', color: '#9ca3af', unlinked: true },
]

const PHASES: Record<Phase, { tab: string; name: string; event: string; rule: string }> = {
  lobby: { tab: 'Lobby', name: 'Lobby', event: 'lobby', rule: 'Everyone in the channel can talk while you wait for the game to start.' },
  tasks: { tab: 'Tasks', name: 'Tasks', event: 'game-start', rule: 'The round is on. Every linked player is muted, alive or dead.' },
  meeting: { tab: 'Meeting', name: 'Emergency meeting', event: 'meeting-start', rule: 'Living players can talk. Theo and Ines are dead and stay muted.' },
}
const ORDER: readonly Phase[] = ['lobby', 'tasks', 'meeting']
const CYCLE_MS = 4200
const TABS: TabsItem[] = ORDER.map((key) => ({ label: PHASES[key].tab, value: key }))

const phase = ref<Phase>('lobby')
const auto = ref(false)
const paused = ref(false)
const runKey = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined

const info = computed(() => PHASES[phase.value])

function stateOf(player: Player, p: Phase): State {
  const dead = Boolean(player.dies) && p === 'meeting'
  if (player.unlinked) return { kind: 'idle', icon: 'i-lucide-mic', label: 'Untouched', dead }
  if (p === 'lobby' || (p === 'meeting' && !dead)) return { kind: 'talk', icon: 'i-lucide-audio-lines', label: 'Can talk', dead }
  return { kind: 'muted', icon: dead ? 'i-lucide-skull' : 'i-lucide-mic-off', label: dead ? 'Dead, muted' : 'Muted', dead }
}

const members = computed(() => PLAYERS.map((player) => ({ ...player, state: stateOf(player, phase.value) })))
const talking = computed(() => members.value.filter((m) => m.state.kind === 'talk').length)
const muted = computed(() => members.value.filter((m) => m.state.kind === 'muted').length)

function schedule() {
  clearTimeout(timer)
  if (paused.value) return
  timer = setTimeout(() => {
    phase.value = ORDER[(ORDER.indexOf(phase.value) + 1) % ORDER.length]!
    runKey.value++
    schedule()
  }, CYCLE_MS)
}

function onPick(value: string | number) {
  paused.value = true
  auto.value = false
  clearTimeout(timer)
  phase.value = value as Phase
}

onMounted(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  auto.value = true
  schedule()
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="frame" :style="{ '--cycle': `${CYCLE_MS}ms` }">
    <div class="frame-bar">
      <div class="frame-title">
        <UIcon name="i-lucide-volume-2" class="frame-icon" />Among Us night <small>voice channel</small>
      </div>
      <UBadge color="primary" variant="soft" label="Host is here" />
    </div>
    <div class="frame-body">
      <div class="voice">
        <UTabs
          :model-value="phase"
          :items="TABS"
          :content="false"
          aria-label="Round phase"
          class="phase-tabs"
          :ui="{ root: 'items-start', list: 'phase-list', trigger: 'phase-trigger', indicator: 'phase-indicator' }"
          @update:model-value="onPick"
        >
          <template #trailing="{ item }">
            <span v-if="auto && item.value === phase" :key="runKey" class="bar" />
          </template>
        </UTabs>
        <ul class="members" :aria-live="paused ? 'polite' : 'off'">
          <li v-for="m in members" :key="m.name" class="member" :class="{ talking: m.state.kind === 'talk', dead: m.state.dead }">
            <UAvatar :text="m.name[0]" size="lg" class="avatar" :style="{ background: m.color }" :ui="{ fallback: 'text-[#0f0f12] font-semibold' }" aria-hidden="true" />
            <span class="who">
              <strong>{{ m.name }}<span v-if="m.host" class="host-tag">Host</span></strong>
              <small>{{ m.au }}</small>
            </span>
            <Transition name="state" mode="out-in">
              <span :key="m.state.label" class="state" :class="m.state.kind">
                <UIcon :name="m.state.icon" class="state-icon" />{{ m.state.label }}
              </span>
            </Transition>
          </li>
        </ul>
      </div>
      <aside class="round" aria-label="Round state">
        <div>
          <p class="round-label">Round state</p>
          <Transition name="state" mode="out-in">
            <p :key="info.name" class="round-phase">{{ info.name }}</p>
          </Transition>
        </div>
        <p class="round-rule">{{ info.rule }}</p>
        <div class="tally">
          <div><b>{{ talking }}</b><span><UIcon name="i-lucide-mic" class="tally-icon" />Can talk</span></div>
          <div><b>{{ muted }}</b><span><UIcon name="i-lucide-mic-off" class="tally-icon" />Muted</span></div>
        </div>
        <p class="event">
          <UIcon name="i-lucide-radio" class="event-icon" />Plugin event <code>{{ info.event }}</code>
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.frame { margin: 88px auto 0; max-width: 1120px; border: 1px solid var(--line); border-radius: 12px; background: rgba(17, 17, 24, .82); overflow: hidden; }
.frame-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--line); }
.frame-title { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 17px; min-width: 0; }
.frame-icon { width: 18px; height: 18px; color: var(--muted); flex: none; }
.frame-title small { font-weight: 400; font-size: 14px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frame-body { display: grid; grid-template-columns: 1fr 320px; }
.voice { padding: 22px 24px 26px; }
.phase-tabs { margin-bottom: 20px; }
.phase-tabs :deep(.phase-list) { width: max-content; max-width: 100%; padding: 4px; gap: 4px; border-radius: 8px; background: var(--surface); }
.phase-tabs :deep(.phase-trigger) { position: relative; overflow: hidden; height: 32px; padding: 0 14px; border-radius: 6px; color: var(--muted); font: 500 14px/1 var(--font-sans); flex: none; }
.phase-tabs :deep(.phase-trigger[data-state="active"]) { color: var(--text); }
.phase-tabs :deep(.phase-indicator) { background: var(--surface-2); border-radius: 6px; box-shadow: none; }
.bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: var(--accent); animation: fill var(--cycle) linear forwards; }
@keyframes fill { to { width: 100%; } }
.members { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
.member { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; transition: background-color .3s; }
.member.talking { background: rgba(74, 222, 128, .06); }
.avatar { flex: none; transition: box-shadow .3s, filter .3s; }
.member.talking .avatar { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--talk); }
.member.dead .avatar { filter: grayscale(1) brightness(.6); }
.who { min-width: 0; flex: 1; }
.who strong { display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 15px; }
.who small { display: block; font-size: 12px; color: var(--dim); }
.host-tag { font-size: 11px; font-weight: 500; color: var(--accent-text); }
.state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dim); white-space: nowrap; }
.state-icon { width: 18px; height: 18px; }
.state.muted { color: var(--accent-text); }
.state.talk { color: var(--talk); }
.state-enter-active, .state-leave-active { transition: opacity .18s ease, translate .18s ease; }
.state-enter-from { opacity: 0; translate: 0 4px; }
.state-leave-to { opacity: 0; translate: 0 -4px; }
.round { border-left: 1px solid var(--line); padding: 24px; display: flex; flex-direction: column; gap: 18px; background: rgba(27, 27, 32, .35); }
.round-label { margin: 0; font-size: 13px; font-weight: 500; color: var(--dim); }
.round-phase { font-size: 26px; font-weight: 600; line-height: 1.15; margin: 4px 0 0; }
.round-rule { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.55; min-height: 3.1em; }
.tally { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tally div { background: var(--surface); border-radius: 10px; padding: 12px 14px; }
.tally b { display: block; font-size: 26px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tally span { font-size: 13px; color: var(--dim); display: inline-flex; align-items: center; gap: 6px; }
.tally-icon { width: 14px; height: 14px; }
.event { margin: auto 0 0; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dim); }
.event-icon { width: 15px; height: 15px; }
.event code { font-family: var(--font-mono); color: var(--text); background: var(--surface); border-radius: 4px; padding: 2px 6px; }

@media (max-width: 1100px) {
  .frame-body { grid-template-columns: 1fr; }
  .round { border-left: 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr; align-items: start; }
  .event { grid-column: 1 / -1; }
}

@media (max-width: 760px) {
  .frame { margin-top: 56px; }
  .frame-bar { padding: 12px 16px; }
  .voice { padding: 16px 12px 18px; }
  .phase-tabs :deep(.phase-list) { width: 100%; }
  .phase-tabs :deep(.phase-trigger) { flex: 1; justify-content: center; padding: 0 8px; }
  .members { grid-template-columns: 1fr; gap: 2px; }
  .round { grid-template-columns: 1fr; padding: 18px 16px; }
}

@media (max-width: 400px) {
  .frame-title small { display: none; }
}
</style>
