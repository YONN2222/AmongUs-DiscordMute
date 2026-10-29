<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)
const title = computed(() => (notFound.value ? 'This page drifted off into space.' : 'Something broke on our side.'))
const text = computed(() =>
  notFound.value
    ? 'The link may be old or mistyped. The home page has everything about DiscordMute.'
    : 'The page could not be loaded right now. Try again in a moment.',
)

useSeoMeta({ title: () => (notFound.value ? 'Page not found' : 'Error'), robots: 'noindex' })

const goHome = () => clearError({ redirect: '/' })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <section class="error" aria-labelledby="error-title">
        <SiteSpaceCanvas class="error-space" :stars="160" />
        <UContainer class="max-w-[960px] text-center">
          <UBadge
            color="primary"
            variant="outline"
            size="lg"
            icon="i-lucide-radio-tower"
            :label="`Error ${error.statusCode}`"
            class="error-badge"
          />
          <h1 id="error-title">{{ title }}</h1>
          <p class="error-text">{{ text }}</p>
          <UButton size="lg" icon="i-lucide-house" label="Back to the home page" class="mt-9" @click="goHome" />
        </UContainer>
      </section>
    </NuxtLayout>
  </UApp>
</template>

<style scoped>
.error { position: relative; overflow: hidden; isolation: isolate; margin-top: -88px; padding: 220px 0 160px; min-height: 80vh; }
.error-space {
  -webkit-mask-image: linear-gradient(to bottom, #000 50%, transparent 95%);
  mask-image: linear-gradient(to bottom, #000 50%, transparent 95%);
}
.error-badge { margin-bottom: 24px; padding: 6px 14px 6px 10px; gap: 8px; font-size: 15px; color: #ffc9cb; background: rgba(220, 47, 53, .1); box-shadow: inset 0 0 0 1px rgba(255, 107, 112, .22); font-variant-numeric: tabular-nums; }
h1 { font-size: 64px; line-height: 1; font-weight: 650; letter-spacing: -.03em; margin: 0 auto; max-width: 760px; text-wrap: balance; }
.error-text { margin: 24px auto 0; max-width: 640px; font-size: 19px; line-height: 28px; color: var(--muted); }

@media (max-width: 760px) {
  .error { margin-top: -64px; padding: 150px 0 100px; }
  h1 { font-size: 40px; }
  .error-text { font-size: 17px; line-height: 26px; }
}
</style>
