<script setup lang="ts">
import { ANALYTICS_EVENTS, trackAttrs, trackEvent } from '#shared/analytics'
import { DOWNLOAD_URL } from '#shared/site'
</script>

<template>
  <section class="cta" aria-labelledby="cta-title">
    <UContainer class="max-w-[960px]">
      <div v-reveal class="cta-panel">
        <SiteSpaceCanvas class="cta-space" :stars="90" />
        <img src="/brand/logo-mark-128.png" alt="" width="112" height="112" loading="lazy">
        <div>
          <h2 id="cta-title">Talk in meetings.<br>Stay quiet in tasks.</h2>
          <p>Free and open source under GPLv3. One mod, one bot.</p>
        </div>
        <div class="cta-actions">
          <UButton :to="DOWNLOAD_URL" rel="noopener" size="lg" icon="i-lucide-download" label="Download the mod" class="justify-center" v-bind="trackAttrs(ANALYTICS_EVENTS.download, { location: 'cta' })" />
          <UButton
            to="/#setup"
            size="lg"
            color="neutral"
            variant="link"
            trailing-icon="i-lucide-arrow-right"
            label="Setup"
            class="group"
            @click="trackEvent(ANALYTICS_EVENTS.setup, { location: 'cta' })"
            :ui="{ trailingIcon: 'transition-transform group-hover:translate-x-[3px]' }"
          />
        </div>
      </div>
    </UContainer>
  </section>
</template>

<style scoped>
.cta { padding: 0 0 120px; }
.cta-panel {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 24px 40px;
  align-items: center;
  padding: 48px 56px;
  border-radius: 24px;
  border: 1px solid var(--line);
  background: var(--surface);
}
.cta-space { opacity: .8; }
.cta-panel img { width: 112px; height: 112px; grid-row: span 2; }
h2 { font-size: 44px; line-height: 1.05; font-weight: 650; margin: 0; letter-spacing: -.02em; text-wrap: balance; }
p { margin: 10px 0 0; color: var(--muted); font-size: 17px; }
.cta-actions { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }

@media (max-width: 1023px) {
  .cta-panel { padding: 40px; }
  h2 { font-size: 38px; }
}

@media (max-width: 760px) {
  .cta { padding-bottom: 80px; }
  .cta-panel { grid-template-columns: 1fr; padding: 32px 24px; gap: 20px; }
  .cta-panel img { width: 80px; height: 80px; grid-row: auto; }
  h2 { font-size: 32px; }
  .cta-actions { grid-column: 1; flex-direction: column; align-items: stretch; }
}
</style>
