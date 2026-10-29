import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { TelemetryPacket } from '../../shared/telemetry/schema'
import { getInstanceLastSeen, recordPacket, utcDay } from '../../server/telemetry/store'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)

function makePacket(overrides: Partial<TelemetryPacket> = {}, gamesMuted = 3): TelemetryPacket {
  return {
    schemaVersion: 1,
    packetId: crypto.randomUUID(),
    instanceId: crypto.randomUUID(),
    mode: 'self-host',
    versions: { bot: '1.2.0', plugins: { '1.0.0': 1 }, amongUs: { '2026.3.1': 1 } },
    gauges: { uniqueUsers: 10, activeGames: 1, guilds: 4, connectedPlugins: 1 },
    deltas: { gamesMuted, mutes: 0, unmutes: 0, rateLimitHits: 0, events: {} },
    latency: { avgMs: 0, samples: 0 },
    features: { ghostChat: 1 },
    ...overrides,
  }
}

async function counter(metric: string, mode = 'self-host', day = utcDay(NOW)) {
  const row = await env.DB.prepare(
    'SELECT value FROM daily_counters WHERE day = ?1 AND mode = ?2 AND metric = ?3',
  )
    .bind(day, mode, metric)
    .first<{ value: number }>()
  return row?.value ?? null
}

describe('utcDay', () => {
  it('formats the UTC day', () => {
    expect(utcDay(Date.UTC(2026, 9, 29, 23, 59))).toBe('2026-10-29')
  })
})

describe('recordPacket', () => {
  it('first packet is accepted and creates instance row', async () => {
    const packet = makePacket()
    expect(await recordPacket(env.DB, packet, NOW)).toBe('accepted')
    const row = await env.DB.prepare('SELECT * FROM instances WHERE instance_id = ?1')
      .bind(packet.instanceId)
      .first<Record<string, unknown>>()
    expect(row?.guilds).toBe(4)
    expect(row?.mode).toBe('self-host')
    expect(row?.first_seen_at).toBe(NOW)
    expect(await getInstanceLastSeen(env.DB, packet.instanceId)).toEqual({
      lastSeenAt: NOW,
      lastPacketId: packet.packetId,
      mode: 'self-host',
    })
  })

  it('returns null for an unknown instance', async () => {
    expect(await getInstanceLastSeen(env.DB, crypto.randomUUID())).toBeNull()
  })

  it('adds deltas to daily counters', async () => {
    const first = makePacket({}, 3)
    const before = (await counter('games_muted')) ?? 0
    await recordPacket(env.DB, first, NOW)
    expect(await counter('games_muted')).toBe(before + 3)
    const second = makePacket({ instanceId: first.instanceId }, 2)
    expect(await recordPacket(env.DB, second, NOW + 61_000)).toBe('accepted')
    expect(await counter('games_muted')).toBe(before + 5)
  })

  it('same packetId is a duplicate and counts once', async () => {
    const packet = makePacket({}, 3)
    const before = (await counter('games_muted')) ?? 0
    expect(await recordPacket(env.DB, packet, NOW)).toBe('accepted')
    expect(await recordPacket(env.DB, packet, NOW + 1000)).toBe('duplicate')
    expect(await counter('games_muted')).toBe(before + 3)
  })

  it('concurrent duplicates count once', async () => {
    const packet = makePacket({}, 3)
    const before = (await counter('games_muted')) ?? 0
    const reportsBefore = (await counter('reports')) ?? 0
    const results = await Promise.all([
      recordPacket(env.DB, packet, NOW),
      recordPacket(env.DB, packet, NOW),
    ])
    expect([...results].sort()).toEqual(['accepted', 'duplicate'])
    expect(await counter('games_muted')).toBe(before + 3)
    expect(await counter('reports')).toBe(reportsBefore + 1)
  })

  it('second packet within 60 s is rate limited and adds nothing', async () => {
    const first = makePacket({}, 3)
    await recordPacket(env.DB, first, NOW)
    const before = await counter('games_muted')
    const second = makePacket({ instanceId: first.instanceId }, 5)
    expect(await recordPacket(env.DB, second, NOW + 30_000)).toBe('rate_limited')
    expect(await counter('games_muted')).toBe(before)
    expect(await getInstanceLastSeen(env.DB, first.instanceId)).toEqual({
      lastSeenAt: NOW,
      lastPacketId: first.packetId,
      mode: 'self-host',
    })
  })

  it('skips the instance lookup when the caller passes it in', async () => {
    const packet = makePacket()
    const queries: string[] = []
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'prepare') {
          return (sql: string) => {
            queries.push(sql)
            return target.prepare(sql)
          }
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    expect(await recordPacket(db, packet, NOW, null)).toBe('accepted')
    expect(queries.filter((sql) => sql.startsWith('SELECT last_seen_at'))).toHaveLength(0)
  })

  it('mode cannot change after first packet', async () => {
    const first = makePacket({}, 1)
    await recordPacket(env.DB, first, NOW)
    const hostedBefore = await counter('games_muted', 'hosted')
    const selfBefore = await counter('games_muted', 'self-host')
    const second = makePacket({ instanceId: first.instanceId, mode: 'hosted' }, 2)
    expect(await recordPacket(env.DB, second, NOW + 61_000)).toBe('accepted')
    const row = await env.DB.prepare('SELECT mode FROM instances WHERE instance_id = ?1')
      .bind(first.instanceId)
      .first<{ mode: string }>()
    expect(row?.mode).toBe('self-host')
    expect(await counter('games_muted', 'hosted')).toBe(hostedBefore)
    expect(await counter('games_muted', 'self-host')).toBe((selfBefore ?? 0) + 2)
  })

  it('zero deltas write no counter rows except reports', async () => {
    const day = '2026-11-02'
    const at = Date.UTC(2026, 10, 2, 8, 0, 0)
    const packet = makePacket({}, 0)
    expect(await recordPacket(env.DB, packet, at)).toBe('accepted')
    const { results } = await env.DB.prepare('SELECT metric FROM daily_counters WHERE day = ?1')
      .bind(day)
      .all<{ metric: string }>()
    expect(results.map((r) => r.metric)).toEqual(['reports'])
  })

  it('records event and latency metrics', async () => {
    const at = Date.UTC(2026, 10, 3, 8, 0, 0)
    const packet = makePacket(
      {
        deltas: { gamesMuted: 0, mutes: 4, unmutes: 4, rateLimitHits: 1, events: { lobby: 2 } },
        latency: { avgMs: 120.4, samples: 5 },
      },
      0,
    )
    await recordPacket(env.DB, packet, at)
    const day = utcDay(at)
    expect(await counter('event.lobby', 'self-host', day)).toBe(2)
    expect(await counter('mutes', 'self-host', day)).toBe(4)
    expect(await counter('rate_limit_hits', 'self-host', day)).toBe(1)
    expect(await counter('latency_ms_sum', 'self-host', day)).toBe(602)
    expect(await counter('latency_samples', 'self-host', day)).toBe(5)
  })
})
