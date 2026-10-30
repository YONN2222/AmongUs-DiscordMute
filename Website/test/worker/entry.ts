import { OPS_METRICS_PATH, handleOpsMetrics } from '../../server/ops/opsMetrics'
import { OPS_TELEMETRY_PATH, handleOpsTelemetry } from '../../server/ops/opsTelemetry'
import { handleStats } from '../../server/stats/stats'
import { routeTelemetry } from '../../server/telemetry/route'

export default {
  async fetch(request: Request, bindings: Env, ctx: ExecutionContext): Promise<Response> {
    const telemetry = await routeTelemetry(request, bindings)
    if (telemetry) return telemetry
    if (request.method === 'GET' && new URL(request.url).pathname === '/api/v1/stats') {
      return handleStats(bindings, Date.now(), undefined, (promise) => ctx.waitUntil(promise))
    }
    if (request.method === 'GET' && new URL(request.url).pathname === OPS_TELEMETRY_PATH) {
      return handleOpsTelemetry(request, bindings, Date.now())
    }
    if (request.method === 'GET' && new URL(request.url).pathname === OPS_METRICS_PATH) {
      return handleOpsMetrics(request, bindings, Date.now())
    }
    return new Response('Not found', { status: 404 })
  },
}
