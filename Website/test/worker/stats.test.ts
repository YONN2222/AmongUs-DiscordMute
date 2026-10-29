import { env, exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_WINDOW_MS, ESTABLISHED_INSTANCE_MS, STATS_CACHE_CONTROL, handleStats, readStats } from '../../server/stats/stats'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)

async function reset() {
  await env.DB.batch([env.DB.prepare('DELETE FROM instances'), env.DB.prepare('DELETE FROM daily_counters')])
}

function addCounter(day: string, mode: string, metric: string, value: number) {
  return env.DB.prepare('INSERT INTO daily_counters (day, mode, metric, value) VALUES (?1, ?2, ?3, ?4)')
    .bind(day, mode, metric, value)
    .run()
}

function addInstance(
  mode: string,
  lastSeenAt: number,
  gauges: { users?: number; games?: number; guilds?: number } = {},
  firstSeenAt: number = lastSeenAt - ESTABLISHED_INSTANCE_MS,
) {
  const id = crypto.randomUUID()
  return env.DB.prepare(
    `INSERT INTO instances (instance_id, mode, first_seen_at, last_seen_at, last_packet_id, bot_version,
       plugin_versions, among_us_versions, features, unique_users, active_games, guilds, connected_plugins, latency_avg_ms)
     VALUES (?1, ?2, ?3, ?4, ?5, '1.0.0', '{}', '{}', '{}', ?6, ?7, ?8, 0, 0)`,
  )
    .bind(id, mode, firstSeenAt, lastSeenAt, crypto.randomUUID(), gauges.users ?? 0, gauges.games ?? 0, gauges.guilds ?? 0)
    .run()
}

beforeEach(reset)

describe('readStats', () => {
  it('empty db returns zeros', async () => {
    const zero = { total: 0, selfHost: 0, hosted: 0 }
    expect(await readStats(env.DB, NOW)).toEqual({
      gamesMuted: zero,
      uniqueUsers: zero,
      activeGames: zero,
      guilds: zero,
      updatedAt: NOW,
    })
  })

  it('sums games across modes and days with a per-mode breakdown', async () => {
    await addCounter('2026-10-28', 'self-host', 'games_muted', 4)
    await addCounter('2026-10-29', 'self-host', 'games_muted', 6)
    await addCounter('2026-10-28', 'hosted', 'games_muted', 5)
    await addCounter('2026-10-29', 'hosted', 'mutes', 99)
    expect((await readStats(env.DB, NOW)).gamesMuted).toEqual({ total: 15, selfHost: 10, hosted: 5 })
  })

  it('sums unique users over all instances ever seen, per mode', async () => {
    await addInstance('self-host', NOW - 40 * ACTIVE_WINDOW_MS, { users: 7 })
    await addInstance('self-host', NOW, { users: 3 })
    await addInstance('hosted', NOW - 90 * ACTIVE_WINDOW_MS, { users: 20 })
    expect((await readStats(env.DB, NOW)).uniqueUsers).toEqual({ total: 30, selfHost: 10, hosted: 20 })
  })

  it('counts an instance in unique users only after it reported over at least one hour', async () => {
    await addInstance('self-host', NOW, { users: 5 }, NOW - ESTABLISHED_INSTANCE_MS + 1)
    await addInstance('self-host', NOW, { users: 1_000 }, NOW)
    await addInstance('self-host', NOW, { users: 2 }, NOW - ESTABLISHED_INSTANCE_MS)
    expect((await readStats(env.DB, NOW)).uniqueUsers).toEqual({ total: 2, selfHost: 2, hosted: 0 })
  })

  it('does not count throwaway instances created in a burst', async () => {
    for (let i = 0; i < 30; i += 1) await addInstance('self-host', NOW - i * 1000, { users: 5_000 }, NOW - i * 1000)
    expect((await readStats(env.DB, NOW)).uniqueUsers.total).toBe(0)
  })

  it('activeGames and guilds count only instances seen in last 15 min', async () => {
    await addInstance('self-host', NOW - 60_000, { games: 2, guilds: 3 })
    await addInstance('hosted', NOW - ACTIVE_WINDOW_MS, { games: 5, guilds: 8 })
    await addInstance('hosted', NOW - ACTIVE_WINDOW_MS - 1, { games: 100, guilds: 100 })
    await addInstance('self-host', NOW - 3_600_000, { games: 50, guilds: 50 })
    const stats = await readStats(env.DB, NOW)
    expect(stats.activeGames).toEqual({ total: 7, selfHost: 2, hosted: 5 })
    expect(stats.guilds).toEqual({ total: 11, selfHost: 3, hosted: 8 })
  })
})

describe('GET /api/v1/stats', () => {
  it('API hides activeGames and guilds and exposes the breakdown', async () => {
    await addCounter('2026-10-29', 'self-host', 'games_muted', 2)
    await addInstance('hosted', Date.now(), { users: 4, games: 9, guilds: 9 })
    const response = await exports.default.fetch('http://x/api/v1/stats')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(STATS_CACHE_CONTROL)
    const body = (await response.json()) as { ok: boolean; data: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect('activeGames' in body.data).toBe(false)
    expect('guilds' in body.data).toBe(false)
    expect(body.data.gamesMuted).toEqual({ total: 2, selfHost: 2, hosted: 0 })
    expect(body.data.uniqueUsers).toEqual({ total: 4, selfHost: 0, hosted: 4 })
    expect(typeof body.data.updatedAt).toBe('number')
  })
})

const freshCache = () => caches.open(`stats-${crypto.randomUUID()}`)

function countBatches() {
  let calls = 0
  const DB = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'batch') {
        return (...args: Parameters<D1Database['batch']>) => {
          calls += 1
          return target.batch(...args)
        }
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { bindings: { ...env, DB } as Env, calls: () => calls }
}

describe('handleStats', () => {
  it('returns 503 when the query fails and does not cache it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cache = await freshCache()
    const failing = { ...env, DB: { batch: () => Promise.reject(new Error('d1 down')), prepare: env.DB.prepare.bind(env.DB) } }
    const response = await handleStats(failing as unknown as Env, NOW, cache)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
    expect((await handleStats(env, NOW, cache)).status).toBe(200)
  })

  it('still answers 200 when the cache write rejects, handing the write to waitUntil', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cache = { match: async () => undefined, put: () => Promise.reject(new Error('cache down')) } as unknown as Cache
    const pending: Promise<unknown>[] = []
    const response = await handleStats(env, NOW, cache, (promise) => pending.push(promise))
    expect(response.status).toBe(200)
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  it('does not fail when the cache write rejects and no waitUntil is given', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cache = { match: async () => undefined, put: () => Promise.reject(new Error('cache down')) } as unknown as Cache
    expect((await handleStats(env, NOW, cache)).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  it('serves a second request within the TTL from the edge cache', async () => {
    const cache = await freshCache()
    const spy = countBatches()
    const first = await handleStats(spy.bindings, NOW, cache)
    await addCounter('2026-10-29', 'self-host', 'games_muted', 9)
    const second = await handleStats(spy.bindings, NOW + 30_000, cache)
    expect(spy.calls()).toBe(1)
    expect(await second.json()).toEqual(await first.json())
    expect(second.headers.get('cache-control')).toBe(STATS_CACHE_CONTROL)
  })
})
