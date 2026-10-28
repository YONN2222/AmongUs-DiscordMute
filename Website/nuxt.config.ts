export default defineNuxtConfig({
  compatibilityDate: '2026-10-23',
  modules: ['@nuxt/ui', '@nuxtjs/seo'],
  css: ['~/assets/css/main.css'],
  ogImage: false,
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: true, nodeCompat: true },
    typescript: { tsConfig: { include: ['../worker-configuration.d.ts'] } },
  },
  icon: { serverBundle: { collections: ['lucide'] } },
})
