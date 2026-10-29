<script setup lang="ts">
import type { TabsItem, TimelineItem } from '@nuxt/ui'
import { DOWNLOAD_URL, GITHUB_URL } from '#shared/site'

const BEPINEX_URL = 'https://builds.bepinex.dev/projects/bepinex_be/735/BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.735%2B5fef357.zip'
const DEVELOPER_PORTAL_URL = 'https://discord.com/developers/applications'
const GUIDE_URL = `${GITHUB_URL}#readme`

const hosted = useHostedView()
const hostedClosed = computed(() => hosted.value.status !== 'available')
const tab = ref('self')
const selfHostAction = computed(() => [
  { label: hosted.value.cta.label, color: 'neutral' as const, variant: 'outline' as const, onClick: () => { tab.value = 'self' } },
])
const TABS: TabsItem[] = [
  { label: 'Self-host', icon: 'i-lucide-server', value: 'self', slot: 'self' as const },
  { label: 'Hosted', icon: 'i-lucide-cloud', value: 'hosted', slot: 'hosted' as const },
]

type Step = TimelineItem & { where: string; whereIcon: string }
const SELF_STEPS: Step[] = [
  { title: 'Install BepInEx', avatar: { text: '1' }, where: 'Game PC', whereIcon: 'i-lucide-package', slot: 'bepinex' },
  { title: 'Add the mod', avatar: { text: '2' }, where: 'Game PC', whereIcon: 'i-lucide-package', slot: 'mod' },
  { title: 'Set up the bot', avatar: { text: '3' }, where: 'DiscordBot/config.json', whereIcon: 'i-lucide-file-cog', slot: 'bot' },
  { title: 'Point the mod at the bot', avatar: { text: '4' }, where: 'BepInEx/DiscordMute/config.json', whereIcon: 'i-lucide-file-cog', slot: 'plugin' },
  { title: 'Start the bot and link', avatar: { text: '5' }, where: 'In game and Discord', whereIcon: 'i-brand-discord', slot: 'start' },
]
const HOSTED_STEPS: Step[] = [
  { title: 'Invite the bot', avatar: { text: '1' }, where: 'Discord', whereIcon: 'i-brand-discord', slot: 'invite' },
  { title: 'Install the mod', avatar: { text: '2' }, where: 'Game PC', whereIcon: 'i-lucide-package', slot: 'install' },
  { title: 'Run /setup', avatar: { text: '3' }, where: 'Manage Server', whereIcon: 'i-lucide-shield-check', slot: 'setup' },
  { title: 'Switch the mod to hosted', avatar: { text: '4' }, where: 'BepInEx/DiscordMute/config.json', whereIcon: 'i-lucide-file-cog', slot: 'hosted' },
]

const TIMELINE_UI = {
  item: 'gap-4 sm:gap-6',
  indicator: 'size-8 sm:size-10 bg-elevated ring ring-default text-highlighted font-semibold text-sm sm:text-[15px]',
  separator: 'bg-(--line) my-2 w-0.5 rounded-full',
  wrapper: 'min-w-0 pb-9 sm:pb-11 pt-0.5 sm:pt-1.5',
  title: 'mb-2 flex flex-wrap items-center gap-2.5 text-[19px] sm:text-[21px] font-semibold',
  description: 'text-[15px] leading-[1.65] text-muted',
}
</script>

<template>
  <SiteSection id="setup" title="Set it up" tight>
    <template #description>Self-hosting works today. {{ hosted.headline }}.</template>
    <UTabs
      v-reveal
      class="setup-tabs"
      :items="TABS"
      v-model="tab"
      :unmount-on-hide="false"
      :ui="{ list: 'tablist', trigger: 'tab-trigger', indicator: 'tab-indicator', leadingIcon: 'size-4', content: 'tab-content' }"
    >
      <template #trailing="{ item }">
        <UBadge v-if="item.value === 'hosted' && hostedClosed" color="neutral" variant="soft" size="sm" :label="hosted.badge" />
      </template>

      <template #self>
        <UTimeline orientation="vertical" color="neutral" size="xl" :items="SELF_STEPS" :default-value="-1" :ui="TIMELINE_UI">
          <template #title="{ item }">
            {{ item.title }}
            <UBadge color="neutral" variant="soft" :icon="(item as Step).whereIcon" :label="(item as Step).where" class="where" />
          </template>
          <template #bepinex-description>
            <p>
              Already using a mod that ships BepInEx? Skip this. Otherwise get the
              <ULink :to="BEPINEX_URL" rel="noopener" class="inline-link">64-bit BepInEx 6.0.0-be.735 (IL2CPP)</ULink> build. It
              works for Steam, Epic Games and the Microsoft Store. Extract it into your Among Us folder. itch.io builds are 32-bit
              and not supported.
            </p>
          </template>
          <template #mod-description>
            <p>
              Download the <ULink :to="DOWNLOAD_URL" rel="noopener" class="inline-link">latest release</ULink>, copy
              <code class="code">DiscordMute.dll</code> into <code class="code">BepInEx/plugins</code>, then start Among Us once
              and close it. That creates <code class="code">BepInEx/DiscordMute/config.json</code>.
            </p>
          </template>
          <template #bot-description>
            <p>
              In the <code class="code">DiscordBot</code> folder of the release, rename <code class="code">config.example.json</code>
              to <code class="code">config.json</code>. Create an application and bot in the
              <ULink :to="DEVELOPER_PORTAL_URL" rel="noopener" class="inline-link">Discord Developer Portal</ULink> and fill in the
              values. Pick your own <code class="code">secret</code>.
            </p>
<pre><code>{
  <span class="k">"token"</span>: <span class="s">"YOUR_BOT_TOKEN"</span>,
  <span class="k">"clientId"</span>: <span class="s">"YOUR_CLIENT_ID"</span>,
  <span class="k">"guildId"</span>: <span class="s">"YOUR_GUILD_ID"</span>,
  <span class="k">"channelIds"</span>: [],
  <span class="k">"secret"</span>: <span class="s">"replace-this-with-your-own-secret"</span>,
  <span class="k">"botIp"</span>: <span class="s">"localhost"</span>,
  <span class="k">"botPort"</span>: <span class="n">7264</span>,
  <span class="k">"databaseDialect"</span>: <span class="s">"sqlite"</span>
}</code></pre>
          </template>
          <template #plugin-description>
            <p>
              Use the same <code class="code">secret</code> as the bot, and the bot's IP and port. <code class="code">exe</code>
              points to <code class="code">start.bat</code> in the <code class="code">DiscordBot</code> folder, so the bot starts
              with the game.
            </p>
<pre><code>{
  <span class="k">"ip"</span>: <span class="s">"localhost"</span>,
  <span class="k">"botPort"</span>: <span class="n">7264</span>,
  <span class="k">"secret"</span>: <span class="s">"replace-this-with-your-own-secret"</span>,
  <span class="k">"exe"</span>: <span class="s">"C:\\Path\\To\\DiscordBot\\start.bat"</span>,
  <span class="k">"bridgeLogsToBotConsole"</span>: <span class="n">false</span>
}</code></pre>
            <UAlert color="warning" variant="soft" icon="i-lucide-info" class="mt-3.5 tip">
              <template #description>
                Use <code class="code">\\</code> or <code class="code">/</code> in the path. A single backslash breaks the JSON,
                the mod falls back to the default secret and the bot rejects it.
              </template>
            </UAlert>
          </template>
          <template #start-description>
            <p>
              Host a lobby, online or LAN. The bot starts on its own through <code class="code">exe</code>. Everyone runs
              <code class="code">/link self</code>, sends their code in the lobby chat and joins the host's voice channel.
            </p>
            <p>Not sure it's connected? Run <code class="code">/testconnection</code> in Discord.</p>
          </template>
        </UTimeline>
        <UAlert color="neutral" variant="outline" icon="i-lucide-book-open" class="mt-2" :ui="{ icon: 'text-(--indigo-text)', description: 'text-[15px] text-muted' }">
          <template #description>
            Every config key is explained in the <ULink :to="GUIDE_URL" rel="noopener" class="inline-link">setup guide on GitHub</ULink>.
          </template>
        </UAlert>
      </template>

      <template #hosted>
        <UAlert
          v-if="hostedClosed"
          color="primary"
          variant="soft"
          icon="i-lucide-cloud"
          :title="hosted.headline"
          :description="hosted.body"
          :actions="selfHostAction"
          class="mb-10"
          :ui="{ root: 'p-5 items-center rounded-(--radius-card) bg-elevated text-highlighted', icon: 'size-7 text-(--accent-text)', title: 'text-[17px]' }"
        />
        <UTimeline orientation="vertical" color="neutral" size="xl" :items="HOSTED_STEPS" :default-value="-1" :ui="TIMELINE_UI" :class="{ 'opacity-75': hostedClosed }">
          <template #title="{ item }">
            {{ item.title }}
            <UBadge color="neutral" variant="soft" :icon="(item as Step).whereIcon" :label="(item as Step).where" class="where" />
          </template>
          <template #invite-description>
            <p>Add the DiscordMute bot to your server. There is no bot of your own to run.</p>
            <UButton v-if="hosted.inviteUrl" :to="hosted.inviteUrl" rel="noopener" size="lg" icon="i-brand-discord" :label="hosted.cta.label" class="mt-4" />
          </template>
          <template #install-description>
            <p>
              Install BepInEx and copy <code class="code">DiscordMute.dll</code> into <code class="code">BepInEx/plugins</code>,
              the same way as for self-hosting.
            </p>
          </template>
          <template #setup-description>
            <p>
              An admin runs <code class="code">/setup</code> in your server, presses <b>Create secret</b> and copies the secret. It is
              shown only once.
            </p>
          </template>
          <template #hosted-description>
            <p>Set <code class="code">mode</code> to <code class="code">hosted</code> and paste the secret.</p>
<pre><code>{
  <span class="k">"mode"</span>: <span class="s">"hosted"</span>,
  <span class="k">"secret"</span>: <span class="s">"your-server-secret"</span>
}</code></pre>
          </template>
        </UTimeline>
      </template>
    </UTabs>
  </SiteSection>
</template>

<style scoped>
.setup-tabs { display: block; }
.setup-tabs :deep(.tablist) { width: max-content; max-width: 100%; margin: 0 0 48px; padding: 4px; gap: 4px; border-radius: 8px; background: var(--surface); }
.setup-tabs :deep(.tab-trigger) { gap: 8px; height: 36px; padding: 0 16px; border-radius: 6px; color: var(--muted); font: 500 14px/1 var(--font-sans); flex: none; }
.setup-tabs :deep(.tab-trigger[data-state="active"]) { color: var(--text); }
.setup-tabs :deep(.tab-indicator) { background: var(--surface-2); border-radius: 6px; box-shadow: none; }
.setup-tabs :deep(.tab-content) { outline-offset: 6px; }
.setup-tabs :deep(.tab-content[data-state="active"]) { animation: tab-in .35s cubic-bezier(.2, .7, .2, 1); }
@keyframes tab-in { from { opacity: 0; translate: 0 8px; } }
.where { font-size: 12.5px; border-radius: 6px; overflow-wrap: anywhere; white-space: normal; }
.setup-tabs p { margin: 0; max-width: 68ch; }
.setup-tabs p + p { margin-top: 10px; }
.inline-link { color: var(--accent-text); font-weight: 500; }
.inline-link:hover { text-decoration: underline; }
pre { margin: 16px 0 0; padding: 18px 20px; border-radius: 10px; background: var(--code-bg); border: 1px solid var(--line); overflow-x: auto; font-family: var(--font-mono); font-size: 13.5px; line-height: 1.7; color: #d8d8de; }
pre .k { color: #ff8f93; }
pre .s { color: #8fe3b0; }
pre .n { color: #f5c26b; }
.tip { background: rgba(245, 181, 68, .07); color: #e9d6ad; }

@media (max-width: 760px) {
  .setup-tabs :deep(.tablist) { margin-bottom: 36px; }
  pre { font-size: 12.5px; padding: 14px; }
}
</style>
