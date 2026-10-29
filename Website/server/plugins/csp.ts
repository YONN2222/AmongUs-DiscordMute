import { contentSecurityPolicy } from '../security/csp'

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return
  nitroApp.hooks.hook('render:response', async (response, { event }) => {
    if (typeof response.body !== 'string') return
    setResponseHeader(event, 'Content-Security-Policy', await contentSecurityPolicy(response.body))
  })
})
