import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { routeTelemetry } from '../../server/telemetry/route'
import { validPacket } from './fixtures'

const post = (url: string, body: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.200' },
    body,
  })

describe('routeTelemetry', () => {
  it('handles POST on the telemetry path', async () => {
    const response = await routeTelemetry(post('http://x/api/v1/telemetry', JSON.stringify(validPacket())), env)
    expect(response?.status).toBe(202)
  })

  it('handles the telemetry path with a query string', async () => {
    const response = await routeTelemetry(post('http://x/api/v1/telemetry?x=1', '{'), env)
    expect(response?.status).toBe(400)
  })

  it('leaves other methods and paths to the site', () => {
    expect(routeTelemetry(new Request('http://x/api/v1/telemetry'), env)).toBeUndefined()
    expect(routeTelemetry(post('http://x/api/v1/health', '{}'), env)).toBeUndefined()
    expect(routeTelemetry(post('http://x/api/v1/telemetry/', '{}'), env)).toBeUndefined()
  })

  it('is what the worker entry serves', async () => {
    const response = await exports.default.fetch(post('http://x/api/v1/telemetry', 'not json'))
    expect(response.status).toBe(400)
    expect((await exports.default.fetch('http://x/api/v1/telemetry')).status).toBe(404)
  })
})
