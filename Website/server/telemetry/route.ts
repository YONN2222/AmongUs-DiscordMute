import { TELEMETRY_PATH } from '../../shared/telemetry/contract'
import { handleIngest } from './ingest'

// Runs on the raw Worker request, before Nitro buffers the body.
export function routeTelemetry(request: Request, env: Env, url = new URL(request.url)): Promise<Response> | undefined {
  if (request.method !== 'POST' || url.pathname !== TELEMETRY_PATH) return undefined
  return handleIngest(request, env, Date.now())
}
