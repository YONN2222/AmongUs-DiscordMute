<script setup lang="ts">
const COMMANDS = [
  { cmd: '/link self', text: 'Start linking your own account' },
  { cmd: '/link force user display-name', text: 'Link someone manually (admins)' },
  { cmd: '/link reset [user]', text: 'Unlink yourself, or others with Manage Server' },
  { cmd: '/testconnection', text: 'Check that the bot can reach the mod' },
]

const SPECS = [
  { icon: 'i-lucide-puzzle', title: 'TOHE and EHR', description: 'Better name matching. With EHR, a blackmailed player stays muted in meetings.' },
  { icon: 'i-lucide-key-round', title: 'One socket, one secret', description: 'A single WebSocket with a shared secret, never sent in a URL.' },
  { icon: 'i-lucide-package', title: 'Just bot.exe', description: 'Releases are compiled. No Bun or Node.js to install.' },
  { icon: 'i-lucide-terminal', title: 'Log bridging', description: 'Optionally forward mod logs to the bot console.' },
]

const CARD_UI = { container: 'h-full', wrapper: 'h-full', footer: 'w-full pt-5' }
</script>

<template>
  <SiteSection id="features" title="What it does" tight>
    <template #description>Everything here ships in the current release.</template>
    <div class="bento">
      <UPageCard v-reveal variant="soft" title="Link from the lobby" class="wide" :ui="CARD_UI">
        <template #description>
          <code class="code">/link self</code> gives you a text code for free chat and a two-phrase code for quick chat, so
          guest and quick-chat-only accounts can link too. Codes expire after 5 minutes.
        </template>
        <template #footer>
          <div class="proof chat" role="img" aria-label="Example: two players link their accounts in the lobby chat">
            <div class="bubble">
              <UAvatar text="R" size="sm" class="bubble-avatar" style="background: #7c8cff" :ui="{ fallback: 'text-[#0f0f12] font-semibold' }" />
              <div><small>rhea, free chat</small><span class="msg"><span class="qc">link-AB12</span></span></div>
            </div>
            <USeparator label="or" :ui="{ border: 'border-default', label: 'text-xs text-dimmed font-normal' }" />
            <div class="bubble">
              <UAvatar text="M" size="sm" class="bubble-avatar" style="background: #4ade80" :ui="{ fallback: 'text-[#0f0f12] font-semibold' }" />
              <div>
                <small>milo.exe, two quick chat messages</small>
                <span class="msg">
                  <span class="qc">Skeld <em>Location</em></span>
                  <span class="qc">Faster Player Speed <em>Crew</em></span>
                </span>
              </div>
            </div>
            <p class="ok-line"><UIcon name="i-lucide-check" class="ok-icon" />Account linked successfully!</p>
          </div>
        </template>
      </UPageCard>

      <UPageCard v-reveal="90" variant="soft" title="Follows the host" :ui="CARD_UI">
        <template #description>
          Mutes whichever voice channel the host is in. <code class="code">channelIds</code> is only a fallback.
        </template>
        <template #footer>
          <div class="proof channel" role="img" aria-label="Example: the voice channel the host is in is the one that gets muted">
            <span class="ch on"><UIcon name="i-lucide-volume-2" class="ch-icon" />Among Us night<UBadge color="primary" variant="soft" label="Host" class="ms-auto" /></span>
            <span class="ch"><UIcon name="i-lucide-volume-2" class="ch-icon" />Lounge</span>
            <span class="ch"><UIcon name="i-lucide-volume-2" class="ch-icon" />Music</span>
          </div>
        </template>
      </UPageCard>

      <UPageCard v-reveal variant="soft" title="Crash-safe" :ui="CARD_UI">
        <template #description>
          The bot remembers whom it muted and undoes it after a crash or restart. Mutes your moderators set stay put.
        </template>
        <template #footer>
          <div class="proof log" role="img" aria-label="Example: what happens after a restart">
            <span><b>21:04</b>Muted 6 players</span>
            <span class="warn"><b>21:06</b>Bot restarted</span>
            <span class="ok"><b>21:06</b>Unmuted those 6</span>
            <span><b>21:06</b>Kept Jun's mod mute</span>
          </div>
        </template>
      </UPageCard>

      <UPageCard v-reveal="90" variant="soft" title="Admin commands" class="wide" :ui="CARD_UI">
        <template #description>
          Fix links by hand when the normal flow can't be finished, and check the connection while you set things up.
        </template>
        <template #footer>
          <dl class="proof cmds">
            <div v-for="c in COMMANDS" :key="c.cmd" class="cmd">
              <dt><code>{{ c.cmd }}</code></dt>
              <dd>{{ c.text }}</dd>
            </div>
          </dl>
        </template>
      </UPageCard>

      <div v-reveal class="specs">
        <UPageFeature v-for="s in SPECS" :key="s.title" :icon="s.icon" :title="s.title" :description="s.description" orientation="vertical" class="spec" />
      </div>
    </div>
  </SiteSection>
</template>

<style scoped>
.bento { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.wide { grid-column: span 2; }
.bento :deep([data-slot="footer"]) { margin-top: auto; }
.proof { border-radius: 12px; background: #0e0e14; border: 1px solid var(--line); padding: 16px; font-size: 14px; min-width: 0; }
.chat { display: grid; gap: 10px; }
.bubble { display: flex; align-items: flex-start; gap: 10px; }
.bubble-avatar { flex: none; }
.bubble > div { min-width: 0; }
.bubble small { display: block; color: var(--dim); font-size: 12px; margin-bottom: 2px; }
.msg { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; color: var(--text); }
.qc { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--line); font-size: 13px; color: #e6e6e6; }
.qc em { font-style: normal; color: var(--dim); font-size: 12px; }
.ok-line { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--talk); font-size: 13px; }
.ok-icon { width: 16px; height: 16px; }
.log { display: grid; gap: 10px; color: var(--muted); }
.log span { display: flex; gap: 12px; align-items: baseline; }
.log b { font-weight: 400; color: var(--dim); font-variant-numeric: tabular-nums; font-size: 13px; }
.log .ok { color: var(--talk); }
.log .warn { color: var(--warn); }
.cmds { display: grid; gap: 6px; margin: 0; }
.cmd { display: grid; grid-template-columns: minmax(0, 250px) minmax(0, 1fr); gap: 4px 16px; align-items: baseline; padding: 10px 12px; border-radius: 8px; transition: background-color .15s; }
.cmd:nth-child(odd) { background: rgba(255, 255, 255, .025); }
.cmd:hover { background: rgba(255, 255, 255, .05); }
.cmd code { font-family: var(--font-mono); color: #fff; font-size: 13.5px; overflow-wrap: anywhere; }
.cmd dd { margin: 0; color: var(--muted); font-size: 14px; }
.channel { display: grid; gap: 6px; }
.ch { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; color: var(--dim); }
.ch-icon { width: 16px; height: 16px; }
.ch.on { background: rgba(220, 47, 53, .1); color: var(--text); }
.ch.on .ch-icon { color: var(--accent-text); }
.specs { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-radius: var(--radius-card); border: 1px solid var(--line); }
.spec + .spec { border-left: 1px solid var(--line); }

@media (max-width: 1023px) {
  .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wide { grid-column: 1 / -1; }
  .specs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .spec:nth-child(3) { border-left: 0; }
  .spec:nth-child(n+3) { border-top: 1px solid var(--line); }
}

@media (max-width: 760px) {
  .bento, .specs { grid-template-columns: minmax(0, 1fr); }
  .spec + .spec { border-left: 0; border-top: 1px solid var(--line); }
  .cmd { grid-template-columns: minmax(0, 1fr); }
}
</style>
