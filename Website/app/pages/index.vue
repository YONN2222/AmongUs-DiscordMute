<script setup lang="ts">
import { DOWNLOAD_URL, GITHUB_URL, SITE_DESCRIPTION } from '#shared/site'
import { faqFor } from '~/content/faq'

const hosted = useHostedView()
const statsVisible = useStatsVisible()
const faq = computed(() => faqFor(hosted.value))

useHead({ titleTemplate: '%s' })
useSeoMeta({ title: 'DiscordMute: automatic Discord muting for Among Us', description: SITE_DESCRIPTION })
useSchemaOrg([
  defineSoftwareApp({
    name: 'DiscordMute',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Windows',
    offers: { price: 0, priceCurrency: 'USD' },
    downloadUrl: DOWNLOAD_URL,
    codeRepository: GITHUB_URL,
    license: 'https://www.gnu.org/licenses/gpl-3.0.html',
  }),
  defineWebPage({ '@type': ['WebPage', 'FAQPage'] }),
  ...faq.value.map((entry) => defineQuestion({ name: entry.question, acceptedAnswer: entry.answer })),
])
</script>

<template>
  <div>
    <HomeHeroSection />
    <HomeCounterPanel v-if="statsVisible" />
    <HomeHowItWorks />
    <HomeFeatureGrid />
    <HomeSetupGuide />
    <HomeFaqList />
    <HomeCtaPanel />
  </div>
</template>
