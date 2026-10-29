import { handleStats } from '../../server/stats/stats'
import { routeTelemetry } from '../../server/telemetry/route'

export default {
  async fetch(request: Request, bindings: Env, ctx: ExecutionContext): Promise<Response> {
    const telemetry = await routeTelemetry(request, bindings)
    if (telemetry) return telemetry
    if (request.method === 'GET' && new URL(request.url).pathname === '/api/v1/stats') {
      return handleStats(bindings, Date.now(), undefined, (promise) => ctx.waitUntil(promise))
    }
    return new Response('Not found', { status: 404 })
  },
}
