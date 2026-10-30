import { handleOpsMetrics } from '../../../ops/opsMetrics'
import { cloudflareEnv } from '../../../utils/cloudflare'

export default defineEventHandler((event) => {
  const request = new Request(getRequestURL(event), { headers: getRequestHeaders(event) as HeadersInit })
  return handleOpsMetrics(request, cloudflareEnv(event), Date.now())
})
