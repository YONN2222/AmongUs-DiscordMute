<script setup lang="ts">
import { DOWNLOAD_URL, GITHUB_URL, HOSTED_BOT_INVITE_URL } from '#shared/site'

const ui = {
  root: 'static',
  container: 'max-w-[1200px] pt-34 sm:pt-44 lg:pt-49 pb-0 sm:pb-0 lg:pb-0 gap-12 lg:grid-cols-[1.25fr_.75fr]',
  headline: 'mb-6',
  title: 'text-[39px] min-[401px]:text-[44px] sm:text-[60px] lg:text-[76px] leading-[1.02] lg:leading-[.98] font-[650] tracking-[-0.03em] text-balance',
  description: 'mt-7 text-[17px] leading-[26px] sm:text-[19px] sm:leading-7 text-muted max-w-[560px]',
  links: 'mt-10 gap-x-4 gap-y-3 max-sm:flex-col max-sm:items-stretch',
}
</script>

<template>
  <div class="hero">
    <SiteSpaceCanvas class="hero-space" :stars="260" />
    <UPageHero orientation="horizontal" :ui="ui">
      <template #headline>
        <UBadge
          color="primary"
          variant="outline"
          size="lg"
          icon="i-lucide-mic-off"
          label="Automatic voice muting for Among Us"
          class="hero-badge"
        />
      </template>
      <template #title>Discord goes quiet when the round starts.</template>
      <template #description>
        A BepInEx mod tells your Discord bot what happens in the game. Everyone is muted during tasks, the living can talk in
        meetings, and the dead stay quiet.
      </template>
      <template #links>
        <UButton :to="DOWNLOAD_URL" rel="noopener" size="lg" icon="i-lucide-download" label="Download the mod" class="justify-center" />
        <UButton
          v-if="HOSTED_BOT_INVITE_URL"
          :to="HOSTED_BOT_INVITE_URL"
          rel="noopener"
          size="lg"
          icon="i-brand-discord"
          label="Invite the bot"
          class="justify-center"
        />
        <UButton
          :to="GITHUB_URL"
          rel="noopener"
          size="lg"
          color="neutral"
          variant="link"
          icon="i-brand-github"
          trailing-icon="i-lucide-arrow-right"
          label="GitHub"
          class="group"
          :ui="{ trailingIcon: 'transition-transform group-hover:translate-x-[3px]' }"
        />
      </template>
      <img class="hero-logo" src="/brand/logo-stack-360.png" alt="DiscordMute logo" width="360" height="285" fetchpriority="high">
    </UPageHero>
    <UContainer class="max-w-[1200px]">
      <HomeVoiceDemo v-reveal />
      <p class="frame-caption">
        Only linked players are touched. Kai never ran <code class="code">/link self</code>, so the bot leaves them alone.
      </p>
    </UContainer>
  </div>
</template>

<style scoped>
.hero { position: relative; overflow: hidden; isolation: isolate; margin-top: -88px; }
.hero-space {
  -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent 92%);
  mask-image: linear-gradient(to bottom, #000 55%, transparent 92%);
}
.hero-badge { padding: 6px 14px 6px 8px; gap: 10px; font-size: 15px; color: #ffc9cb; background: rgba(220, 47, 53, .1); box-shadow: inset 0 0 0 1px rgba(255, 107, 112, .22); }
.hero-badge :deep(span:first-child) { color: var(--accent-text); }
.hero-logo {
  justify-self: center;
  width: 100%;
  max-width: 380px;
  height: auto;
  filter: drop-shadow(0 24px 40px rgba(0, 0, 0, .5));
  animation: float 7s ease-in-out infinite;
}
@keyframes float { 50% { translate: 0 -10px; } }
.frame-caption { text-align: center; color: var(--muted); font-size: 16px; margin: 24px auto 0; max-width: 640px; }

@media (max-width: 1023px) {
  .hero-logo { order: -1; max-width: 240px; justify-self: start; }
}

@media (max-width: 760px) {
  .hero { margin-top: -64px; }
  .hero-logo { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .hero-logo { animation: none; }
}
</style>
