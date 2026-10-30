import { handleOpsTelemetry } from '../../../ops/opsTelemetry'
import { cloudflareEnv } from '../../../utils/cloudflare'

export default defineEventHandler((event) => {
  const request = new Request(getRequestURL(event), { headers: getRequestHeaders(event) as HeadersInit })
  return handleOpsTelemetry(request, cloudflareEnv(event), Date.now())
})
