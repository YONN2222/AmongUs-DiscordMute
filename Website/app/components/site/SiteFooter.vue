<script setup lang="ts">
import type { FooterColumn } from '@nuxt/ui'
import { DOCS_URL, DOWNLOAD_URL, GITHUB_URL } from '#shared/site'

const year = new Date().getFullYear()
const columns: FooterColumn[] = [
  {
    label: 'Project',
    children: [
      { label: 'Releases', icon: 'i-lucide-download', to: DOWNLOAD_URL, rel: 'noopener' },
      { label: 'GitHub', icon: 'i-brand-github', to: GITHUB_URL, rel: 'noopener' },
      { label: 'Setup', icon: 'i-lucide-list-checks', to: '/#setup' },
      { label: 'Docs', icon: 'i-lucide-book-open', to: DOCS_URL, rel: 'noopener' },
    ],
  },
  {
    label: 'Legal',
    children: [
      { label: 'Privacy', icon: 'i-lucide-lock', to: '/privacy' },
      { label: 'Terms', icon: 'i-lucide-scroll-text', to: '/terms' },
    ],
  },
]
</script>

<template>
  <UFooter :ui="{ top: 'pt-8 pb-14 lg:pt-8 lg:pb-14', container: 'border-t border-default py-6 lg:py-6 text-sm text-dimmed', left: 'mt-0', right: 'mt-2 lg:mt-0' }">
    <template #top>
      <UContainer>
        <UFooterColumns
          :columns="columns"
          :ui="{
            root: 'grid gap-10 lg:grid-cols-[2fr_1fr_1fr] xl:grid-cols-[2fr_1fr_1fr]',
            left: 'mb-0',
            center: 'contents',
            label: 'text-base font-semibold text-highlighted',
            list: 'mt-3.5 space-y-2.5',
            link: 'text-base text-muted hover:text-highlighted transition-colors gap-2',
            linkLeadingIcon: 'size-4',
            linkLabelExternalIcon: 'hidden',
          }"
        >
          <template #left>
            <img class="foot-logo" src="/brand/logo-wordmark-480.png" alt="DiscordMute" width="240" height="66">
            <p class="foot-text">An Among Us mod and Discord bot that mutes your voice channel in step with the round. Open source under GPLv3.</p>
            <p class="foot-text">Not affiliated with or endorsed by Innersloth.</p>
          </template>
        </UFooterColumns>
      </UContainer>
    </template>
    <template #left>
      <span>Copyright {{ year }} DiscordMute</span>
    </template>
    <template #right>
      <span>GPLv3</span>
    </template>
  </UFooter>
</template>

<style scoped>
.foot-logo { display: block; width: 220px; height: auto; margin: -6px 0 18px; }
.foot-text { margin: 0; color: var(--muted); line-height: 1.65; max-width: 520px; }
.foot-text + .foot-text { margin-top: 14px; }
</style>
