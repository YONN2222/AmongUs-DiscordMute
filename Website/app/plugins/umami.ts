import { UMAMI_SCRIPT_URLS, UMAMI_WEBSITE_ID } from '#shared/analytics'

export default defineNuxtPlugin(() => {
  if (import.meta.dev) return
  useHead({
    script: UMAMI_SCRIPT_URLS.map((src) => ({ src, defer: true, 'data-website-id': UMAMI_WEBSITE_ID })),
  })
})
