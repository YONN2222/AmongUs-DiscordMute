import { handleStats } from '../../stats/stats'
import { cloudflareEnv } from '../../utils/cloudflare'

export default defineEventHandler((event) => {
  const waitUntil = event.context.cloudflare?.context?.waitUntil?.bind(event.context.cloudflare.context)
  return handleStats(cloudflareEnv(event), Date.now(), undefined, waitUntil)
})
