import { fileURLToPath } from 'node:url'
import type { Nitro } from 'nitropack'

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
  app: {
    head: {
      htmlAttrs: { lang: 'en', class: 'dark' },
      link: [
        { rel: 'icon', type: 'image/png', href: '/brand/favicon-64.png' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/outfit-variable.woff2', crossorigin: '' },
      ],
      meta: [{ name: 'theme-color', content: '#111118' }],
    },
  },
  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      },
    },
  },
  nitro: {
    preset: 'cloudflare_module',
    modules: [useWorkerEntry],
    cloudflare: { deployConfig: true, nodeCompat: true },
    typescript: { tsConfig: { include: ['../worker-configuration.d.ts'] } },
  },
  icon: {
    serverBundle: { collections: ['lucide'] },
    customCollections: [{ prefix: 'brand', dir: './app/assets/icons/brand' }],
  },
})
