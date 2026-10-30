import { contentSecurityPolicy } from '../security/csp'

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    setResponseHeader(event, 'Content-Security-Policy', await contentSecurityPolicy(html))
  })
})
