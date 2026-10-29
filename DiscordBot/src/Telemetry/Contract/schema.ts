import { z } from 'zod'

export const TELEMETRY_SCHEMA_VERSION = 1
export const TELEMETRY_MODES = ['self-host', 'hosted'] as const
export const TELEMETRY_EVENT_NAMES = ['lobby', 'game-start', 'meeting-start', 'meeting-end'] as const
export const TELEMETRY_FEATURES = [
  'linkOverview',
  'serverLog',
  'voiceRules',
  'phaseDelays',
  'ghostChat',
  'autoRelink',
  'liveStatus',
  'spectatorHandling',
  'nicknameSync',
  'matchSummary',
] as const

export type TelemetryMode = (typeof TELEMETRY_MODES)[number]
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number]
export type TelemetryFeature = (typeof TELEMETRY_FEATURES)[number]

export type TelemetryPacket = {
  schemaVersion: 1
  packetId: string
  instanceId: string
  mode: TelemetryMode
  versions: {
    bot: string
    plugins: Record<string, number>
    amongUs: Record<string, number>
  }
  gauges: { uniqueUsers: number; activeGames: number; guilds: number; connectedPlugins: number }
  deltas: {
    gamesMuted: number
    mutes: number
    unmutes: number
    rateLimitHits: number
    events: Partial<Record<TelemetryEventName, number>>
  }
  latency: { avgMs: number; samples: number }
  features: Partial<Record<TelemetryFeature, number>>
}

export const VERSION_PATTERN = /^[0-9]+(\.[0-9]+){0,3}(-(alpha|beta|rc|dev)(\.[0-9]{1,4})?)?$/
const MAX_VERSION_LENGTH = 32
const MAX_VERSION_KEYS = 16

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const version = z.string().max(MAX_VERSION_LENGTH).regex(VERSION_PATTERN)
const versionCounts = z
  .record(version, count)
  .refine((record) => Object.keys(record).length <= MAX_VERSION_KEYS, {
    message: `at most ${MAX_VERSION_KEYS} versions`,
  })
  .meta({ maxProperties: MAX_VERSION_KEYS })

export const telemetryPacketSchema: z.ZodType<TelemetryPacket> = z.strictObject({
  schemaVersion: z.literal(TELEMETRY_SCHEMA_VERSION),
  packetId: z.uuid(),
  instanceId: z.uuid({ version: 'v4' }),
  mode: z.enum(TELEMETRY_MODES),
  versions: z.strictObject({
    bot: version,
    plugins: versionCounts,
    amongUs: versionCounts,
  }),
  gauges: z.strictObject({
    uniqueUsers: count,
    activeGames: count,
    guilds: count,
    connectedPlugins: count,
  }),
  deltas: z.strictObject({
    gamesMuted: count,
    mutes: count,
    unmutes: count,
    rateLimitHits: count,
    events: z.partialRecord(z.enum(TELEMETRY_EVENT_NAMES), count),
  }),
  latency: z.strictObject({
    avgMs: z.number().nonnegative().max(30000),
    samples: count,
  }),
  features: z.partialRecord(z.enum(TELEMETRY_FEATURES), count),
})
