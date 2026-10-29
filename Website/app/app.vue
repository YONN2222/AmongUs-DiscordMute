<script setup lang="ts">
useHead({ titleTemplate: '%s | DiscordMute' })
useSeoMeta({
  ogImage: '/og.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'DiscordMute: automatic Discord muting for Among Us',
  twitterCard: 'summary_large_image',
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
