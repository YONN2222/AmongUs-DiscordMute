export default {
  async fetch(_request: Request, _bindings: Env): Promise<Response> {
    return new Response('Not found', { status: 404 })
  },
}
