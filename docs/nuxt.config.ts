export default defineNuxtConfig({
  extends: ['docus'],
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark', fallback: 'dark' },
  site: {
    name: 'DiscordMute',
    description: 'Mute Discord voice automatically during Among Us rounds.',
  },
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/png', href: '/brand/favicon-64.png' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/outfit-variable.woff2', crossorigin: '' },
      ],
      meta: [{ name: 'theme-color', content: '#111118' }],
    },
  },
})
