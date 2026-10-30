export default defineNuxtConfig({
  extends: ['docus'],
  modules: ['@nuxt/ui'],
  devtools: false,
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark', fallback: 'dark' },
  content: {
    database: { type: 'd1', bindingName: 'DB' },
  },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { nodeCompat: true },
    routeRules: {
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-Frame-Options': 'DENY',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        },
      },
    },
  },
  site: {
    name: 'DiscordMute',
    url: 'https://docs.mute.yonn2222.com',
    description: 'Mute Discord voice automatically during Among Us rounds.',
  },
  app: {
    head: {
      link: [
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/outfit-variable.woff2', crossorigin: '' },
      ],
      meta: [{ name: 'theme-color', content: '#111118' }],
    },
  },
})
