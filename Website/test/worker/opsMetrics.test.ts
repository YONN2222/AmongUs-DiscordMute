import { env, exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPS_METRICS_PATH, handleOpsMetrics } from '../../server/ops/opsMetrics'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const HOUR_MS = 3600 * 1000
const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

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

function addInstance(mode: string, botVersion: string, features: Record<string, number>) {
  const id = crypto.randomUUID()
  const packetId = crypto.randomUUID()
  seededIds.push(id, packetId)
  return env.DB.prepare(
    `INSERT INTO instances (instance_id, mode, first_seen_at, last_seen_at, last_packet_id, bot_version,
       plugin_versions, among_us_versions, features, unique_users, active_games, guilds, connected_plugins, latency_avg_ms)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{"3.0.0":1}', '{"2026.9.29":1}', ?7, 3, 1, 1, 1, 80)`,
  )
    .bind(id, mode, NOW - 2 * HOUR_MS, NOW, packetId, botVersion, JSON.stringify(features))
    .run()
}

function metricsRequest(authorization: string | null = `Bearer ${env.OPS_STATS_TOKEN}`) {
  const headers = new Headers()
  if (authorization !== null) headers.set('authorization', authorization)
  return new Request(`http://x${OPS_METRICS_PATH}`, { headers })
}

beforeEach(reset)

describe('access', () => {
  it('404 when OPS_STATS_TOKEN is not configured', async () => {
    const response = await handleOpsMetrics(metricsRequest(), { ...env, OPS_STATS_TOKEN: undefined } as Env, NOW)
    expect(response.status).toBe(404)
  })

  it('401 without or with a wrong bearer', async () => {
    expect((await handleOpsMetrics(metricsRequest(null), env, NOW)).status).toBe(401)
    expect((await handleOpsMetrics(metricsRequest('Bearer not-the-token'), env, NOW)).status).toBe(401)
  })

  it('every response is no-store, noindex and Prometheus text', async () => {
    const responses = [
      await handleOpsMetrics(metricsRequest(), env, NOW),
      await handleOpsMetrics(metricsRequest(null), env, NOW),
      await handleOpsMetrics(metricsRequest(), { ...env, OPS_STATS_TOKEN: undefined } as Env, NOW),
    ]
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-robots-tag')).toBe('noindex')
      expect(response.headers.get('content-type')).toBe(CONTENT_TYPE)
    }
  })

  it('is routed through the worker entry', async () => {
    const response = await exports.default.fetch(metricsRequest())
    expect(response.status).toBe(200)
  })

  it('503 when the query fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = { ...env, DB: { prepare: () => { throw new Error('d1 down') } } }
    const response = await handleOpsMetrics(metricsRequest(), failing as unknown as Env, NOW)
    expect(response.status).toBe(503)
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })
})

describe('metrics', () => {
  it('exposes the aggregated data of both modes', async () => {
    await addCounter('2026-10-27', 'self-host', 'games_muted', 2)
    await addCounter('2026-10-28', 'self-host', 'games_muted', 3)
    await addCounter('2026-10-28', 'hosted', 'mutes', 7)
    await addInstance('self-host', '3.0.0', { linkOverview: 1 })
    await addInstance('hosted', '3.1.0', {})

    const response = await handleOpsMetrics(metricsRequest(), env, NOW)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('discordmute_telemetry_games_muted_total{mode="self-host"} 5')
    expect(text).toContain('discordmute_telemetry_mutes_total{mode="hosted"} 7')
    expect(text).toContain('discordmute_telemetry_instances{mode="self-host"} 1')
    expect(text).toContain('discordmute_telemetry_instances_active{mode="hosted"} 1')
    expect(text).toContain('discordmute_telemetry_bot_version_instances{mode="hosted",version="3.1.0"} 1')
    expect(text).toContain('discordmute_telemetry_feature_instances{mode="self-host",feature="linkOverview"} 1')
    expect(text).toContain('discordmute_telemetry_mute_latency_avg_seconds{mode="self-host"} 0.08')
  })

  it('never contains instance or packet ids', async () => {
    await addInstance('self-host', '3.0.0', { linkOverview: 1 })
    await addInstance('hosted', '3.0.0', { voiceRules: 1 })
    const text = await (await handleOpsMetrics(metricsRequest(), env, NOW)).text()
    for (const id of seededIds) expect(text).not.toContain(id)
    expect(text).not.toMatch(/instance_id|packet_id/)
  })
})
