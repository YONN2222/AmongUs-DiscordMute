<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { ANALYTICS_EVENTS, trackAttrs, trackEvent } from '#shared/analytics'
import { DOCS_URL, DOWNLOAD_URL, GITHUB_URL } from '#shared/site'

const SECTIONS = ['how', 'features', 'setup', 'faq'] as const
const LABELS: Record<(typeof SECTIONS)[number], string> = {
  how: 'How it works',
  features: 'Features',
  setup: 'Setup',
  faq: 'FAQ',
}

const route = useRoute()
const open = ref(false)
const onHome = computed(() => route.path === '/')
const section = useActiveSection(SECTIONS)

const tracked = (name: string): Pick<NavigationMenuItem, 'onSelect'> => ({
  onSelect: () => trackEvent(ANALYTICS_EVENTS.nav, { item: name }),
})

const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Home', to: '/', active: onHome.value && section.value === null, ...tracked('home') },
  ...SECTIONS.map((id) => ({ label: LABELS[id], to: `/#${id}`, active: onHome.value && section.value === id, ...tracked(id) })),
  { label: 'Docs', icon: 'i-lucide-book-open', to: DOCS_URL, target: '_self', rel: 'noopener', active: false, ...tracked('docs') },
  { label: 'GitHub', icon: 'i-brand-github', to: GITHUB_URL, target: '_self', rel: 'noopener', active: false, ...tracked('github') },
])
</script>

<template>
  <UHeader
    v-model:open="open"
    class="site-header"
    mode="slideover"
    :menu="{ side: 'right' }"
    :ui="{ container: 'site-header-inner', center: 'site-header-center', toggle: 'site-header-toggle', body: 'site-header-body' }"
  >
    <template #title>
      <span class="site-logo">
        <img src="/brand/logo-mark-128.png" alt="" width="38" height="38">
        <span>Discord<b>Mute</b></span>
      </span>
    </template>

    <UNavigationMenu :items="items" variant="pill" color="neutral" highlight-color="neutral" class="site-nav" :ui="{ link: 'site-nav-link', linkLeadingIcon: 'site-nav-icon' }" />

    <template #right>
      <UButton :to="DOWNLOAD_URL" rel="noopener" size="md" class="site-cta" label="Download" v-bind="trackAttrs(ANALYTICS_EVENTS.download, { location: 'nav' })" />
    </template>

    <template #body>
      <UNavigationMenu :items="items" orientation="vertical" variant="pill" color="neutral" class="site-nav-mobile" :ui="{ link: 'site-nav-mobile-link', linkLeadingIcon: 'site-nav-icon' }" />
      <UButton :to="DOWNLOAD_URL" rel="noopener" size="lg" class="site-cta-mobile" icon="i-lucide-download" label="Download the mod" v-bind="trackAttrs(ANALYTICS_EVENTS.download, { location: 'nav-mobile' })" />
    </template>
  </UHeader>
</template>

<style>
.site-header {
  --ui-header-height: 72px;
  top: 16px;
  max-width: var(--max);
  margin: 16px auto 0;
  border: 0;
  border-radius: 8px;
  background: rgba(10, 10, 14, .55);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.site-header-inner { max-width: none; padding: 0 24px 0 32px; }
.site-logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 24px; letter-spacing: -.015em; color: var(--text); }
.site-logo img { width: 38px; height: 38px; margin: -4px 0; }
.site-logo b { font-weight: 700; color: var(--indigo-text); }
.site-nav-link { height: 36px; padding: 8px 16px; font-size: 14px; font-weight: 500; color: var(--text); }
.site-nav-link::before { transition: background-color .15s; }
.site-nav-link:hover::before, .site-nav-link[data-active]::before { background: var(--surface); }
.site-nav-link[data-active] { color: var(--text); }
.site-nav-icon { width: 16px; height: 16px; color: currentColor; }
.site-header-toggle { width: 40px; height: 40px; justify-content: center; color: var(--text); }
.site-header-body { display: grid; gap: 16px; }
.site-nav-mobile-link { height: 44px; padding: 10px 12px; font-size: 16px; font-weight: 500; color: var(--text); }
.site-nav-mobile-link[data-active]::before { background: var(--surface); }
.site-cta-mobile { width: 100%; height: 44px; justify-content: center; }

@media (max-width: 1023px) {
  .site-header-inner { padding: 0 16px 0 24px; }
  .site-cta { display: none; }
}

@media (max-width: 760px) {
  .site-header { --ui-header-height: 64px; top: 0; margin-top: 0; border-radius: 0; }
}

@media (max-width: 400px) {
  .site-logo { font-size: 21px; }
}
</style>
