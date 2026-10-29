<script setup lang="ts">
const RULES = [
  { phase: 'Lobby', label: 'Everyone talks', talk: true },
  { phase: 'Tasks', label: 'Everyone muted', talk: false },
  { phase: 'Meeting', label: 'The living talk', talk: true },
  { phase: 'Dead players', label: 'Muted until the lobby', talk: false },
]
</script>

<template>
  <SiteSection id="how" title="How it works" tight>
    <template #description>Two pieces you install together: a mod for the game and a Discord bot. They talk over one WebSocket.</template>
    <UPageGrid as="ol" class="steps">
      <UPageCard v-reveal as="li" variant="soft" title="Install the mod">
        <template #leading><UBadge color="primary" variant="soft" label="1" class="step-n" /></template>
        <template #description>
          The host puts <code class="code">DiscordMute.dll</code> into <code class="code">BepInEx/plugins</code> and hosts a
          lobby, online or LAN. Nobody else installs anything.
        </template>
      </UPageCard>
      <UPageCard v-reveal="90" as="li" variant="soft" title="Link once">
        <template #leading><UBadge color="primary" variant="soft" label="2" class="step-n" /></template>
        <template #description>
          Each player runs <code class="code">/link self</code> in Discord and sends the code in the lobby chat. Free chat and
          quick chat both work.
        </template>
      </UPageCard>
      <UPageCard v-reveal="180" as="li" variant="soft" title="Play">
        <template #leading><UBadge color="primary" variant="soft" label="3" class="step-n" /></template>
        <template #description>
          The bot mutes and unmutes the host's voice channel as the round changes. When the game ends or the connection drops,
          it always unmutes everyone.
        </template>
      </UPageCard>
    </UPageGrid>
    <dl v-reveal class="rules">
      <div v-for="rule in RULES" :key="rule.phase" class="rule">
        <dt>{{ rule.phase }}</dt>
        <dd :class="rule.talk ? 'talk' : 'mute'">
          <UIcon :name="rule.talk ? 'i-lucide-mic' : 'i-lucide-mic-off'" class="rule-icon" />{{ rule.label }}
        </dd>
      </div>
    </dl>
  </SiteSection>
</template>

<style scoped>
.steps { gap: 16px; padding: 0; margin: 0; list-style: none; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.step-n { width: 32px; height: 32px; justify-content: center; border-radius: 8px; font-size: 15px; font-weight: 600; }
.rules { margin: 16px 0 0; display: grid; grid-template-columns: repeat(4, 1fr); border-radius: var(--radius-card); border: 1px solid var(--line); overflow: hidden; }
.rule { padding: 20px 22px; }
.rule + .rule { border-left: 1px solid var(--line); }
.rule dt { font-size: 14px; color: var(--dim); margin-bottom: 6px; }
.rule dd { margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 16px; }
.rule-icon { width: 18px; height: 18px; flex: none; }
.talk { color: var(--talk); }
.mute { color: var(--accent-text); }

@media (max-width: 1023px) {
  .steps { grid-template-columns: 1fr; }
  .rules { grid-template-columns: 1fr 1fr; }
  .rule:nth-child(3) { border-left: 0; }
  .rule:nth-child(n+3) { border-top: 1px solid var(--line); }
}

@media (max-width: 760px) {
  .rules { grid-template-columns: 1fr; }
  .rule + .rule { border-left: 0; border-top: 1px solid var(--line); }
}
</style>
