<script setup lang="ts">
import { LEGAL_UPDATED_AT, PRIVACY_SECTIONS } from '~/content/legal'

useSeoMeta({
  title: 'Privacy policy',
  description:
    'What DiscordMute collects: no cookies or tracking on this site, anonymous telemetry totals from bots, and the data the hosted bot stores.',
})
</script>

<template>
  <SiteLegalPage title="Privacy policy" :updated-at="LEGAL_UPDATED_AT" :sections="PRIVACY_SECTIONS" />
</template>
