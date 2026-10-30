import { fileURLToPath } from 'node:url'
import type { Nitro } from 'nitropack'
import { API_SECURITY_HEADERS, SECURITY_HEADERS } from './server/security/csp'
import { DEFAULT_HOSTED_STATUS } from './shared/hostedStatus'
import { DEFAULT_STATS_VISIBILITY } from './shared/statsVisibility'
import { CANONICAL_ORIGIN, DEFAULT_HOSTED_BOT_CLIENT_ID, SITE_DESCRIPTION, SITE_NAME } from './shared/site'

const workerEntry = fileURLToPath(new URL('./server/cloudflare-entry.ts', import.meta.url))

// Only the production Worker build gets the custom entry; dev and prerender keep Nitro's own.
function useWorkerEntry(nitro: Nitro) {
  if (nitro.options.preset === 'cloudflare-module' && !nitro.options.dev) {
    nitro.options.entry = workerEntry
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2026-10-23',
  modules: ['@nuxt/ui', '@nuxtjs/seo'],
  css: ['~/assets/css/main.css'],
  ui: { fonts: false, colorMode: false },
  ogImage: false,
  site: { url: CANONICAL_ORIGIN, name: SITE_NAME, description: SITE_DESCRIPTION, defaultLocale: 'en', env: 'production' },
  sitemap: { exclude: ['/api/**'] },
  // Overridden at runtime by the Worker variables NUXT_PUBLIC_HOSTED_STATUS, NUXT_PUBLIC_HOSTED_BOT_CLIENT_ID and NUXT_PUBLIC_STATS.
  runtimeConfig: {
    public: {
      hostedStatus: DEFAULT_HOSTED_STATUS,
      hostedBotClientId: DEFAULT_HOSTED_BOT_CLIENT_ID,
      stats: DEFAULT_STATS_VISIBILITY,
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en', class: 'dark' },
      link: [
        { rel: 'icon', type: 'image/png', href: '/brand/favicon-64.png' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/outfit-variable.woff2', crossorigin: '' },
      ],
      meta: [{ name: 'theme-color', content: '#0a0a0f' }],
    },
  },
  routeRules: {
    '/': { swr: 60 },
    '/**': {
      headers: { ...SECURITY_HEADERS },
    },
    '/api/**': {
      headers: { ...API_SECURITY_HEADERS },
    },
  },
  nitro: {
    preset: 'cloudflare_module',
    modules: [useWorkerEntry],
    cloudflare: { deployConfig: true, nodeCompat: true },
    typescript: { tsConfig: { include: ['../worker-configuration.d.ts'] } },
  },
  icon: {
    fallbackToApi: false,
    serverBundle: { collections: ['lucide'] },
    customCollections: [{ prefix: 'brand', dir: './app/assets/icons/brand' }],
  },
})
