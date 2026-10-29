<script setup lang="ts">
import { LEGAL_UPDATED_AT, TERMS_SECTIONS } from '~/content/legal'

useSeoMeta({
  title: 'Terms of service',
  description:
    'The rules for using DiscordMute: acceptable use, hosted bot availability, the GPLv3 software license and no affiliation with Innersloth or Discord.',
})
</script>

<template>
  <SiteLegalPage title="Terms of service" :updated-at="LEGAL_UPDATED_AT" :sections="TERMS_SECTIONS" />
</template>
