<script setup lang="ts">
const PRIVACY_URL = 'https://mute.yonn2222.com/privacy'
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
    <a
      :href="PRIVACY_URL"
      class="hover:text-highlighted transition-colors"
      :data-umami-event="ANALYTICS_EVENTS.privacy"
      data-umami-event-location="footer"
    >Privacy</a>
    <span>Copyright {{ new Date().getFullYear() }}</span>
  </div>
</template>
