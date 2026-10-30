import { env, exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_WINDOW_MS, ESTABLISHED_INSTANCE_MS } from '../../server/stats/stats'
import { OPS_RECENT_WINDOW_MS, OPS_TELEMETRY_PATH, handleOpsTelemetry, type OpsRow } from '../../server/ops/opsTelemetry'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const URL_BASE = `http://x${OPS_TELEMETRY_PATH}`

type InstanceSeed = {
  mode?: string
  lastSeenAt?: number
  firstSeenAt?: number
  botVersion?: string
  plugins?: Record<string, number>
  amongUs?: Record<string, number>
  features?: Record<string, unknown>
  users?: number
  games?: number
  guilds?: number
  connectedPlugins?: number
  latencyMs?: number
}

const seededIds: string[] = []

async function reset() {
  seededIds.length = 0
  await env.DB.batch([env.DB.prepare('DELETE FROM instances'), env.DB.prepare('DELETE FROM daily_counters')])
}

function addCounter(day: string, mode: string, metric: string, value: number) {
  return env.DB.prepare('INSERT INTO daily_counters (day, mode, metric, value) VALUES (?1, ?2, ?3, ?4)')
    .bind(day, mode, metric, value)
    .run()
}

function addInstance(seed: InstanceSeed = {}) {
  const id = crypto.randomUUID()
  const packetId = crypto.randomUUID()
  seededIds.push(id, packetId)
  const lastSeenAt = seed.lastSeenAt ?? NOW
  return env.DB.prepare(
    `INSERT INTO instances (instance_id, mode, first_seen_at, last_seen_at, last_packet_id, bot_version,
       plugin_versions, among_us_versions, features, unique_users, active_games, guilds, connected_plugins, latency_avg_ms)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  )
    .bind(
      id,
      seed.mode ?? 'self-host',
      seed.firstSeenAt ?? lastSeenAt - ESTABLISHED_INSTANCE_MS,
      lastSeenAt,
      packetId,
      seed.botVersion ?? '3.0.0',
      JSON.stringify(seed.plugins ?? {}),
      JSON.stringify(seed.amongUs ?? {}),
      JSON.stringify(seed.features ?? {}),
      seed.users ?? 0,
      seed.games ?? 0,
      seed.guilds ?? 0,
      seed.connectedPlugins ?? 0,
      seed.latencyMs ?? 0,
    )
    .run()
}

function opsRequest(search: string, authorization: string | null = `Bearer ${env.OPS_STATS_TOKEN}`) {
  const headers = new Headers()
  if (authorization !== null) headers.set('authorization', authorization)
  return new Request(`${URL_BASE}${search}`, { headers })
}

async function rows(search: string): Promise<OpsRow[]> {
  const response = await handleOpsTelemetry(opsRequest(search), env, NOW)
  expect(response.status).toBe(200)
  return ((await response.json()) as { ok: true; data: OpsRow[] }).data
}

beforeEach(reset)

describe('access', () => {
  it('404 when OPS_STATS_TOKEN is not configured', async () => {
    const unset = { ...env, OPS_STATS_TOKEN: undefined } as Env
    const response = await handleOpsTelemetry(opsRequest('?view=snapshot'), unset, NOW)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
  })

  it('404 when OPS_STATS_TOKEN is shorter than 32 characters', async () => {
    const short = { ...env, OPS_STATS_TOKEN: 'short-token' } as Env
    const response = await handleOpsTelemetry(opsRequest('?view=snapshot', 'Bearer short-token'), short, NOW)
    expect(response.status).toBe(404)
  })

  it('401 without bearer', async () => {
    const response = await handleOpsTelemetry(opsRequest('?view=snapshot', null), env, NOW)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('401 with a wrong bearer', async () => {
    const response = await handleOpsTelemetry(opsRequest('?view=snapshot', 'Bearer not-the-token'), env, NOW)
    expect(response.status).toBe(401)
  })

  it('400 for a bad query', async () => {
    const response = await handleOpsTelemetry(opsRequest('?view=nope'), env, NOW)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'invalid' })
  })

  it('is routed through the worker entry', async () => {
    const response = await exports.default.fetch(opsRequest('?view=snapshot'))
    expect(response.status).toBe(200)
  })

  it('responses are no-store and noindex', async () => {
    const responses = [
      await handleOpsTelemetry(opsRequest('?view=snapshot'), env, NOW),
      await handleOpsTelemetry(opsRequest('?view=snapshot', null), env, NOW),
      await handleOpsTelemetry(opsRequest('?view=nope'), env, NOW),
      await handleOpsTelemetry(opsRequest('?view=snapshot'), { ...env, OPS_STATS_TOKEN: undefined } as Env, NOW),
    ]
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-robots-tag')).toBe('noindex')
    }
  })

  it('503 when the query fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = { ...env, DB: { prepare: () => { throw new Error('d1 down') }, batch: () => Promise.reject(new Error('d1 down')) } }
    const response = await handleOpsTelemetry(opsRequest('?view=snapshot'), failing as unknown as Env, NOW)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(log).toHaveBeenCalledOnce()
    expect(JSON.stringify(log.mock.calls)).not.toContain(OPS_TELEMETRY_PATH)
    log.mockRestore()
  })
})

describe('daily', () => {
  it('daily rows are filtered by mode and range', async () => {
    await addCounter('2026-10-27', 'self-host', 'games_muted', 1)
    await addCounter('2026-10-28', 'self-host', 'games_muted', 2)
    await addCounter('2026-10-28', 'hosted', 'games_muted', 3)
    await addCounter('2026-10-29', 'hosted', 'mutes', 4)
    expect(await rows('?view=daily&from=2026-10-28&to=2026-10-29')).toEqual([
      { day: '2026-10-28', mode: 'hosted', metric: 'games_muted', value: 3 },
      { day: '2026-10-28', mode: 'self-host', metric: 'games_muted', value: 2 },
      { day: '2026-10-29', mode: 'hosted', metric: 'mutes', value: 4 },
    ])
    expect(await rows('?view=daily&from=2026-10-28&to=2026-10-29&mode=hosted')).toEqual([
      { day: '2026-10-28', mode: 'hosted', metric: 'games_muted', value: 3 },
      { day: '2026-10-29', mode: 'hosted', metric: 'mutes', value: 4 },
    ])
  })

  it('daily adds latency_avg_ms', async () => {
    await addCounter('2026-10-28', 'self-host', 'latency_ms_sum', 1000)
    await addCounter('2026-10-28', 'self-host', 'latency_samples', 7)
    await addCounter('2026-10-28', 'hosted', 'latency_ms_sum', 50)
    await addCounter('2026-10-28', 'hosted', 'latency_samples', 0)
    const data = await rows('?view=daily&from=2026-10-28&to=2026-10-28')
    expect(data).toContainEqual({ day: '2026-10-28', mode: 'self-host', metric: 'latency_avg_ms', value: 142.9 })
    expect(data.filter((row) => 'metric' in row && row.metric === 'latency_avg_ms')).toHaveLength(1)
  })

  it('daily defaults to the last 90 days', async () => {
    await addCounter('2026-08-01', 'self-host', 'mutes', 1)
    await addCounter('2026-07-31', 'self-host', 'mutes', 1)
    expect(await rows('?view=daily')).toEqual([{ day: '2026-08-01', mode: 'self-host', metric: 'mutes', value: 1 }])
  })
})

describe('snapshot', () => {
  it('snapshot counts only active instances for activeGames', async () => {
    await addInstance({ lastSeenAt: NOW - 60_000, games: 2, guilds: 3, connectedPlugins: 4, latencyMs: 100 })
    await addInstance({ lastSeenAt: NOW - ACTIVE_WINDOW_MS - 1, games: 50, guilds: 50, connectedPlugins: 50, latencyMs: 900 })
    await addInstance({ lastSeenAt: NOW - OPS_RECENT_WINDOW_MS - 1, games: 1 })
    await addInstance({ mode: 'hosted', lastSeenAt: NOW, games: 5, guilds: 8, latencyMs: 0 })
    expect(await rows('?view=snapshot')).toEqual([
      {
        mode: 'hosted',
        instancesTotal: 1,
        instancesActive: 1,
        instancesRecent: 1,
        uniqueUsers: 0,
        activeGames: 5,
        guilds: 8,
        connectedPlugins: 0,
        latencyAvgMs: null,
      },
      {
        mode: 'self-host',
        instancesTotal: 3,
        instancesActive: 1,
        instancesRecent: 2,
        uniqueUsers: 0,
        activeGames: 2,
        guilds: 3,
        connectedPlugins: 4,
        latencyAvgMs: 100,
      },
    ])
  })

  it('snapshot applies the established rule to unique users and honours the mode filter', async () => {
    await addInstance({ users: 5, firstSeenAt: NOW - ESTABLISHED_INSTANCE_MS })
    await addInstance({ users: 1000, firstSeenAt: NOW })
    await addInstance({ mode: 'hosted', users: 9 })
    const data = await rows('?view=snapshot&mode=self-host')
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ mode: 'self-host', uniqueUsers: 5, instancesTotal: 2 })
  })
})

describe('versions', () => {
  it('versions sums plugin version counts of recent instances', async () => {
    await addInstance({ botVersion: '3.0.0', plugins: { '3.0.0': 2, '2.9.0': 1 }, amongUs: { '2026.9.29': 3 } })
    await addInstance({ botVersion: '3.0.0', plugins: { '3.0.0': 4 }, amongUs: { '2026.9.29': 4 } })
    await addInstance({ botVersion: '2.9.0', lastSeenAt: NOW - OPS_RECENT_WINDOW_MS - 1, plugins: { '2.9.0': 100 } })
    const data = await rows('?view=versions')
    expect(data).toContainEqual({ mode: 'self-host', kind: 'plugin', version: '3.0.0', count: 6 })
    expect(data).toContainEqual({ mode: 'self-host', kind: 'plugin', version: '2.9.0', count: 1 })
    expect(data).toContainEqual({ mode: 'self-host', kind: 'amongUs', version: '2026.9.29', count: 7 })
    expect(data).toContainEqual({ mode: 'self-host', kind: 'bot', version: '3.0.0', count: 2 })
    expect(data.filter((row) => 'kind' in row && row.kind === 'bot')).toHaveLength(1)
  })
})

describe('features', () => {
  it('features counts instances using each feature', async () => {
    await addInstance({ features: { linkOverview: 3, serverLog: 0, voiceRules: true, ghostChat: false } })
    await addInstance({ features: { linkOverview: 1 } })
    await addInstance({ mode: 'hosted', features: { linkOverview: 2 } })
    await addInstance({ lastSeenAt: NOW - OPS_RECENT_WINDOW_MS - 1, features: { nicknameSync: 4 } })
    const data = await rows('?view=features')
    expect(data).toEqual([
      { mode: 'hosted', feature: 'linkOverview', instances: 1 },
      { mode: 'self-host', feature: 'linkOverview', instances: 2 },
      { mode: 'self-host', feature: 'voiceRules', instances: 1 },
    ])
  })
})

describe('privacy', () => {
  it('response never contains instance ids', async () => {
    await addInstance({ plugins: { '3.0.0': 1 }, features: { linkOverview: 1 }, users: 3, games: 1 })
    await addInstance({ mode: 'hosted', plugins: { '3.0.0': 1 }, features: { linkOverview: 1 } })
    await addCounter('2026-10-28', 'self-host', 'games_muted', 2)
    for (const view of ['daily', 'snapshot', 'versions', 'features']) {
      const body = await (await handleOpsTelemetry(opsRequest(`?view=${view}`), env, NOW)).text()
      for (const id of seededIds) expect(body, view).not.toContain(id)
      expect(body).not.toMatch(/instance_id|last_packet_id/)
    }
  })
})
