import type { TelemetryMode, TelemetryPacket } from '../../shared/telemetry/schema'

export const FIRST_PACKET_WINDOW_SECONDS = 600
export const MAX_WINDOW_SECONDS = 3600
const MIN_WINDOW_SECONDS = 60

type Gauges = TelemetryPacket['gauges']

type ModeLimits = {
  gauges: Gauges
  perMinute: {
    gamesMuted: number
    mutes: number
    unmutes: number
    rateLimitHits: number
    event: number
  }
}

const LIMITS: Record<TelemetryMode, ModeLimits> = {
  'self-host': {
    gauges: { uniqueUsers: 100_000, guilds: 1_000, activeGames: 1_000, connectedPlugins: 1_000 },
    perMinute: { gamesMuted: 10, mutes: 3_000, unmutes: 3_000, rateLimitHits: 3_000, event: 600 },
  },
  hosted: {
    gauges: { uniqueUsers: 50_000_000, guilds: 10_000_000, activeGames: 1_000_000, connectedPlugins: 1_000_000 },
    perMinute: { gamesMuted: 10_000, mutes: 3_000_000, unmutes: 3_000_000, rateLimitHits: 3_000_000, event: 600_000 },
  },
}

export type PlausibilityResult = { ok: true } | { ok: false; reason: string }

const fail = (reason: string): PlausibilityResult => ({ ok: false, reason })
const sum = (record: Record<string, number>) => Object.values(record).reduce((total, n) => total + n, 0)

export function windowSeconds(lastSeenAt: number | null, now: number): number {
  if (lastSeenAt === null) return FIRST_PACKET_WINDOW_SECONDS
  const seconds = (now - lastSeenAt) / 1000
  return Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, seconds))
}

export function checkPlausibility(packet: TelemetryPacket, window: number): PlausibilityResult {
  const limits = LIMITS[packet.mode]
  const { gauges, deltas, latency, versions, features } = packet
  const allowance = (perMinute: number) => Math.ceil((perMinute * window) / 60)

  for (const key of Object.keys(limits.gauges) as (keyof Gauges)[]) {
    if (gauges[key] > limits.gauges[key]) return fail(`gauges.${key}`)
  }

  for (const key of ['gamesMuted', 'mutes', 'unmutes', 'rateLimitHits'] as const) {
    if (deltas[key] > allowance(limits.perMinute[key])) return fail(`deltas.${key}`)
  }
  const eventCap = allowance(limits.perMinute.event)
  for (const [name, value] of Object.entries(deltas.events)) {
    if (value > eventCap) return fail(`deltas.events.${name}`)
  }

  if (gauges.activeGames > gauges.connectedPlugins) return fail('gauges.activeGames')
  for (const [name, value] of Object.entries(features)) {
    if (value > gauges.guilds) return fail(`features.${name}`)
  }
  if (sum(versions.plugins) > gauges.connectedPlugins) return fail('versions.plugins')
  if (sum(versions.amongUs) > gauges.connectedPlugins) return fail('versions.amongUs')

  if (latency.samples > deltas.mutes + deltas.unmutes) return fail('latency.samples')
  if (latency.samples === 0 && latency.avgMs !== 0) return fail('latency.avgMs')

  return { ok: true }
}
