import { routeTelemetry } from '../../server/telemetry/route'

export default {
  async fetch(request: Request, bindings: Env): Promise<Response> {
    return (await routeTelemetry(request, bindings)) ?? new Response('Not found', { status: 404 })
  },
}
