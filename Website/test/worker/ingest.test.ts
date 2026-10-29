import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleIngest } from '../../server/telemetry/ingest'
import { validPacket } from './fixtures'

const URL_INGEST = 'http://x/api/v1/telemetry'
const TOKEN = 'test-hosted-token'

type SendOptions = {
  ip?: string
  contentType?: string
  authorization?: string
}

function uniqueIp() {
  const n = crypto.getRandomValues(new Uint8Array(3))
  return `10.${n[0]}.${n[1]}.${n[2]}`
}

function ingestRequest(body: BodyInit, options: SendOptions = {}) {
  const headers = new Headers({
    'content-type': options.contentType ?? 'application/json',
    'cf-connecting-ip': options.ip ?? uniqueIp(),
  })
  if (options.authorization !== undefined) headers.set('authorization', options.authorization)
  return new Request(URL_INGEST, { method: 'POST', headers, body, duplex: 'half' } as RequestInit)
}

function send(body: unknown, options: SendOptions = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return exports.default.fetch(ingestRequest(raw, options))
}

async function instanceRow(instanceId: string) {
  return env.DB.prepare('SELECT mode, last_packet_id FROM instances WHERE instance_id = ?1')
    .bind(instanceId)
    .first<{ mode: string; last_packet_id: string }>()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/v1/telemetry', () => {
  it('202 accepted for a valid self-host packet', async () => {
    const packet = validPacket()
    const response = await send(packet)
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
    expect(await instanceRow(packet.instanceId)).toEqual({
      mode: 'self-host',
      last_packet_id: packet.packetId,
    })
  })

  it('200 duplicate on retry with same packetId', async () => {
    const packet = validPacket()
    const ip = uniqueIp()
    expect((await send(packet, { ip })).status).toBe(202)
    const retry = await send(packet, { ip })
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ ok: true, status: 'duplicate' })
  })

  it('415 for text/plain', async () => {
    const response = await send(validPacket(), { contentType: 'text/plain' })
    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ ok: false, error: 'unsupported_media_type' })
  })

  it('accepts application/json with a charset', async () => {
    const response = await send(validPacket(), { contentType: 'application/json; charset=utf-8' })
    expect(response.status).toBe(202)
  })

  it('413 for 8193-byte body', async () => {
    const response = await send('x'.repeat(8193))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ ok: false, error: 'too_large' })
  })

  it('413 for a chunked body over the limit without Content-Length', async () => {
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1000).fill(32))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = ingestRequest(stream)
    expect(request.headers.get('content-length')).toBeNull()
    const response = await handleIngest(request, env, Date.now())
    expect(response.status).toBe(413)
    expect(pulls).toBeLessThanOrEqual(10)
    expect(cancelled).toBe(true)
  })

  it('400 for malformed JSON', async () => {
    const response = await send('{"schemaVersion":1,')
    expect(response.status).toBe(400)
  })

  it('400 for packet with extra key userId', async () => {
    const packet = validPacket()
    const response = await send({ ...packet, userId: '123456789012345678' })
    expect(response.status).toBe(400)
    expect(await instanceRow(packet.instanceId)).toBeNull()
  })

  it('response bodies never echo input', async () => {
    const response = await send({ ...validPacket(), userId: 'secret-user' })
    expect(await response.text()).toBe('{"ok":false,"error":"invalid"}')
  })

  it('401 for hosted packet without token', async () => {
    const packet = validPacket({ mode: 'hosted' })
    const response = await send(packet)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' })
    expect(await instanceRow(packet.instanceId)).toBeNull()
  })

  it('401 for wrong token', async () => {
    const wrong = await send(validPacket({ mode: 'hosted' }), { authorization: 'Bearer wrong-token' })
    expect(wrong.status).toBe(401)
    const longer = await send(validPacket({ mode: 'hosted' }), {
      authorization: `Bearer ${TOKEN}x`,
    })
    expect(longer.status).toBe(401)
    const raw = await send(validPacket({ mode: 'hosted' }), { authorization: TOKEN })
    expect(raw.status).toBe(401)
  })

  it('202 for hosted with Bearer test-hosted-token', async () => {
    const packet = validPacket({ mode: 'hosted' })
    const response = await send(packet, { authorization: `Bearer ${TOKEN}` })
    expect(response.status).toBe(202)
    expect((await instanceRow(packet.instanceId))?.mode).toBe('hosted')
  })

  it('ignores an authorization header on a self-host packet', async () => {
    const packet = validPacket()
    const response = await send(packet, { authorization: 'Bearer anything' })
    expect(response.status).toBe(202)
    expect((await instanceRow(packet.instanceId))?.mode).toBe('self-host')
  })

  it('401 for a self-host packet claiming a hosted instance', async () => {
    const ip = uniqueIp()
    const hosted = validPacket({ mode: 'hosted' })
    expect((await send(hosted, { ip, authorization: `Bearer ${TOKEN}` })).status).toBe(202)
    const impostor = validPacket({ instanceId: hosted.instanceId })
    const response = await send(impostor, { ip })
    expect(response.status).toBe(401)
    expect((await instanceRow(hosted.instanceId))?.last_packet_id).toBe(hosted.packetId)
  })

  it('400 for a hosted packet claiming a self-host instance', async () => {
    const ip = uniqueIp()
    const selfHost = validPacket()
    expect((await send(selfHost, { ip })).status).toBe(202)
    const switched = validPacket({ instanceId: selfHost.instanceId, mode: 'hosted' })
    const response = await send(switched, { ip, authorization: `Bearer ${TOKEN}` })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"ok":false,"error":"invalid"}')
    expect((await instanceRow(selfHost.instanceId))?.last_packet_id).toBe(selfHost.packetId)
  })

  it('200 duplicate for a retry of an accepted packet', async () => {
    const ip = uniqueIp()
    const packet = validPacket()
    expect((await send(packet, { ip })).status).toBe(202)
    const retry = await send(packet, { ip })
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ ok: true, status: 'duplicate' })
  })

  it('422 for a first packet claiming more games than 60 s allow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const packet = validPacket({
      deltas: { gamesMuted: 80, mutes: 40, unmutes: 38, rateLimitHits: 0, events: {} },
    })
    expect((await send(packet, { ip: uniqueIp() })).status).toBe(422)
    expect(await instanceRow(packet.instanceId)).toBeNull()
    expect(warn).toHaveBeenCalledWith('telemetry rejected', { reason: 'deltas.gamesMuted', mode: 'self-host' })
  })

  it('shares the new-instance throttle across one IPv6 /64', async () => {
    const [a = 0, b = 0] = crypto.getRandomValues(new Uint16Array(2))
    const prefix = `2001:db8:${a.toString(16)}:${b.toString(16)}`
    for (const host of ['1', '2', '3']) {
      expect((await send(validPacket(), { ip: `${prefix}::${host}` })).status).toBe(202)
    }
    const blocked = await send(validPacket(), { ip: `${prefix}:aaaa:bbbb:cccc:dddd` })
    expect(blocked.status).toBe(429)
  })

  it('422 for implausible packet and nothing stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ip = uniqueIp()
    const packet = validPacket({
      gauges: { uniqueUsers: 100_001, activeGames: 2, guilds: 3, connectedPlugins: 4 },
    })
    const response = await send(packet, { ip })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ ok: false, error: 'implausible' })
    expect(await instanceRow(packet.instanceId)).toBeNull()
    expect(warn).toHaveBeenCalledWith('telemetry rejected', {
      reason: 'gauges.uniqueUsers',
      mode: 'self-host',
    })
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain(packet.instanceId)
    expect(logged).not.toContain(ip)
  })

  it('429 with Retry-After 60 for second packet within 60 s', async () => {
    const ip = uniqueIp()
    const first = validPacket()
    expect((await send(first, { ip })).status).toBe(202)
    const second = validPacket({ instanceId: first.instanceId })
    const response = await send(second, { ip })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({ ok: false, error: 'rate_limited' })
    expect((await instanceRow(first.instanceId))?.last_packet_id).toBe(first.packetId)
  })

  it('429 after 20 requests from the same IP in a minute', async () => {
    const ip = uniqueIp()
    for (let i = 0; i < 20; i += 1) {
      const response = await send('{}', { ip, contentType: 'text/plain' })
      expect(response.status).toBe(415)
    }
    const blocked = await send(validPacket(), { ip })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
    expect(await blocked.json()).toEqual({ ok: false, error: 'rate_limited' })
  })

  it('throttles new instances per IP but not known ones', async () => {
    const ip = uniqueIp()
    const known = validPacket()
    expect((await send(known, { ip })).status).toBe(202)
    expect((await send(validPacket(), { ip })).status).toBe(202)
    expect((await send(validPacket(), { ip })).status).toBe(202)
    const fresh = validPacket()
    const blocked = await send(fresh, { ip })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
    expect(await instanceRow(fresh.instanceId)).toBeNull()
    expect((await send(known, { ip })).status).toBe(200)
  })

  it('never writes the client IP to D1', async () => {
    const ip = uniqueIp()
    expect((await send(validPacket(), { ip })).status).toBe(202)
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    ).all<{ name: string }>()
    for (const { name } of results) {
      const rows = await env.DB.prepare(`SELECT * FROM "${name}"`).all()
      expect(JSON.stringify(rows.results)).not.toContain(ip)
    }
  })
})

describe('handleIngest', () => {
  const blockedLimiter = { limit: async () => ({ success: false }) }
  const openLimiter = { limit: async () => ({ success: true }) }

  it('honours a failed ingest limiter', async () => {
    const stubbed = { ...env, INGEST_LIMITER: blockedLimiter } as Env
    const response = await handleIngest(ingestRequest(JSON.stringify(validPacket())), stubbed, Date.now())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
  })

  it('rejects every hosted packet when the token is not configured', async () => {
    const stubbed = { ...env, HOSTED_TELEMETRY_TOKEN: '' } as Env
    const response = await handleIngest(
      ingestRequest(JSON.stringify(validPacket({ mode: 'hosted' })), { authorization: 'Bearer ' }),
      stubbed,
      Date.now(),
    )
    expect(response.status).toBe(401)
  })

  it('503 unavailable when the ingest limiter throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ip = '198.51.100.77'
    const throwing = {
      limit: async () => {
        throw new Error(`limiter down for ${ip}`)
      },
    }
    const stubbed = { ...env, INGEST_LIMITER: throwing } as unknown as Env
    const response = await handleIngest(ingestRequest(JSON.stringify(validPacket()), { ip }), stubbed, Date.now())
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('{"ok":false,"error":"unavailable"}')
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls)).not.toContain(ip)
  })

  it('503 unavailable when the new-instance limiter throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ip = '198.51.100.78'
    const throwing = {
      limit: async () => {
        throw new Error(`limiter down for ${ip}`)
      },
    }
    const stubbed = { ...env, INGEST_LIMITER: openLimiter, NEW_INSTANCE_LIMITER: throwing } as unknown as Env
    const packet = validPacket()
    const response = await handleIngest(ingestRequest(JSON.stringify(packet), { ip }), stubbed, Date.now())
    expect(response.status).toBe(503)
    expect(await instanceRow(packet.instanceId)).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls)).not.toContain(ip)
  })

  it('400 invalid when the client aborts the body', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('client disconnected'))
      },
    })
    const stubbed = { ...env, INGEST_LIMITER: openLimiter } as Env
    const response = await handleIngest(ingestRequest(stream), stubbed, Date.now())
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"ok":false,"error":"invalid"}')
  })

  it('503 unavailable for an unexpected exception', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = {
      method: 'POST',
      url: 'http://x/api/v1/telemetry',
      headers: {
        get() {
          throw new TypeError('unexpected')
        },
      },
    } as unknown as Request
    const response = await handleIngest(broken, env, Date.now())
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('{"ok":false,"error":"unavailable"}')
    expect(error).toHaveBeenCalledWith('telemetry ingest failed', { error: 'TypeError' })
  })

  it('503 unavailable when D1 fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const brokenDb = {
      prepare: () => {
        throw new Error('D1 down')
      },
    }
    const stubbed = {
      ...env,
      DB: brokenDb,
      INGEST_LIMITER: openLimiter,
      NEW_INSTANCE_LIMITER: openLimiter,
    } as unknown as Env
    const packet = validPacket()
    const response = await handleIngest(ingestRequest(JSON.stringify(packet)), stubbed, Date.now())
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('{"ok":false,"error":"unavailable"}')
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls)).not.toContain(packet.instanceId)
  })
})
