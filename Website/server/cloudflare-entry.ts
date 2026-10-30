import { isPublicAssetURL } from '#nitro-internal-virtual/public-assets'
import { createHandler } from 'nitropack/presets/cloudflare/runtime/_module-handler'
import { withSecurityHeaders } from './security/headers'
import { routeTelemetry } from './telemetry/route'

// Nitro's cloudflare-module entry, with telemetry ingest served on the raw request.
export default createHandler<Env>({
  fetch(...params) {
    const [request, env, , url] = params as unknown as [Request, Env, ExecutionContext, URL]
    const telemetry = routeTelemetry(request, env, url)
    if (telemetry) return telemetry.then(withSecurityHeaders)
    if (env.ASSETS && isPublicAssetURL(url.pathname)) return env.ASSETS.fetch(request)
    return undefined
  },
})
