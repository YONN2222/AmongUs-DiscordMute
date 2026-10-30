import {
  OPS_MODES,
  OPS_RESPONSE_HEADERS,
  checkOpsAccess,
  readFeatures,
  readSnapshot,
  readTotals,
  readVersions,
  type FeatureRow,
  type OpsEnv,
  type SnapshotRow,
  type TotalRow,
  type VersionRow,
} from './opsTelemetry'
import { PROMETHEUS_CONTENT_TYPE, renderPrometheusText, type MetricFamily, type Sample } from './prometheusText'

export const OPS_METRICS_PATH = '/api/v1/ops/metrics'

// Prefixed with telemetry_ so these never clash with the metrics the hosted bot exports itself.
const PREFIX = 'discordmute_telemetry_'
const EVENT_METRIC_PREFIX = 'event.'
const MS_PER_SECOND = 1000

export type OpsMetricsData = {
  totals: TotalRow[]
  snapshot: SnapshotRow[]
  versions: VersionRow[]
  features: FeatureRow[]
}

const COUNTERS: { metric: string; name: string; help: string; scale?: number }[] = [
  { metric: 'reports', name: 'reports_total', help: 'Telemetry reports accepted.' },
  { metric: 'games_muted', name: 'games_muted_total', help: 'Games in which the bot muted players.' },
  { metric: 'mutes', name: 'mutes_total', help: 'Mute actions.' },
  { metric: 'unmutes', name: 'unmutes_total', help: 'Unmute actions.' },
  { metric: 'rate_limit_hits', name: 'rate_limit_hits_total', help: 'Discord rate-limit hits.' },
  { metric: 'latency_ms_sum', name: 'mute_latency_seconds_total', help: 'Sum of all reported mute latencies in seconds.', scale: 1 / MS_PER_SECOND },
  { metric: 'latency_samples', name: 'mute_latency_samples_total', help: 'Mute latency samples behind mute_latency_seconds_total.' },
]

const SNAPSHOT_GAUGES: { field: keyof Omit<SnapshotRow, 'mode' | 'latencyAvgMs'>; name: string; help: string }[] = [
  { field: 'instancesTotal', name: 'instances', help: 'Instances that ever reported.' },
  { field: 'instancesActive', name: 'instances_active', help: 'Instances that reported in the last 15 minutes.' },
  { field: 'instancesRecent', name: 'instances_recent', help: 'Instances that reported in the last 7 days.' },
  { field: 'uniqueUsers', name: 'unique_users', help: 'Unique users across instances running for at least an hour.' },
  { field: 'activeGames', name: 'active_games', help: 'Active games on active instances.' },
  { field: 'guilds', name: 'guilds', help: 'Discord servers on active instances.' },
  { field: 'connectedPlugins', name: 'connected_plugins', help: 'Connected plugins on active instances.' },
]

const VERSION_GAUGES: { kind: VersionRow['kind']; name: string; help: string }[] = [
  { kind: 'bot', name: 'bot_version_instances', help: 'Instances seen in the last 7 days by bot version.' },
  { kind: 'plugin', name: 'plugin_version_sessions', help: 'Plugin sessions on instances seen in the last 7 days by plugin version.' },
  { kind: 'amongUs', name: 'among_us_version_sessions', help: 'Plugin sessions on instances seen in the last 7 days by Among Us version.' },
]

const family = (name: string, type: MetricFamily['type'], help: string, samples: Sample[]): MetricFamily => ({
  name: `${PREFIX}${name}`,
  type,
  help,
  samples,
})

function totalOf(totals: readonly TotalRow[], mode: string, metric: string): number {
  return totals.find((row) => row.mode === mode && row.metric === metric)?.value ?? 0
}

function counterFamilies(totals: readonly TotalRow[]): MetricFamily[] {
  const fixed = COUNTERS.map(({ metric, name, help, scale = 1 }) =>
    family(name, 'counter', help, OPS_MODES.map((mode) => ({ labels: { mode }, value: totalOf(totals, mode, metric) * scale }))),
  )
  const events = totals
    .filter((row) => row.metric.startsWith(EVENT_METRIC_PREFIX))
    .map((row) => ({ labels: { mode: row.mode, type: row.metric.slice(EVENT_METRIC_PREFIX.length) }, value: row.value }))
  return [...fixed, family('plugin_events_total', 'counter', 'Plugin events by type.', events)]
}

function snapshotFamilies(snapshot: readonly SnapshotRow[]): MetricFamily[] {
  const rowOf = (mode: string) => snapshot.find((row) => row.mode === mode)
  const gauges = SNAPSHOT_GAUGES.map(({ field, name, help }) =>
    family(name, 'gauge', help, OPS_MODES.map((mode) => ({ labels: { mode }, value: rowOf(mode)?.[field] ?? 0 }))),
  )
  const latency = snapshot.flatMap(({ mode, latencyAvgMs }) =>
    latencyAvgMs === null ? [] : [{ labels: { mode }, value: latencyAvgMs / MS_PER_SECOND }],
  )
  return [...gauges, family('mute_latency_avg_seconds', 'gauge', 'Average mute latency of active instances in seconds.', latency)]
}

function versionFamilies(versions: readonly VersionRow[]): MetricFamily[] {
  return VERSION_GAUGES.map(({ kind, name, help }) =>
    family(
      name,
      'gauge',
      help,
      versions.filter((row) => row.kind === kind).map((row) => ({ labels: { mode: row.mode, version: row.version }, value: row.count })),
    ),
  )
}

function featureFamily(features: readonly FeatureRow[]): MetricFamily {
  const samples = features.map((row) => ({ labels: { mode: row.mode, feature: row.feature }, value: row.instances }))
  return family('feature_instances', 'gauge', 'Instances seen in the last 7 days that use a feature.', samples)
}

export function opsMetricFamilies(data: OpsMetricsData): MetricFamily[] {
  return [
    ...counterFamilies(data.totals),
    ...snapshotFamilies(data.snapshot),
    ...versionFamilies(data.versions),
    featureFamily(data.features),
  ]
}

async function readOpsMetricsData(db: D1Database, now: number): Promise<OpsMetricsData> {
  const [totals, snapshot, versions, features] = await Promise.all([
    readTotals(db),
    readSnapshot(db, null, now),
    readVersions(db, null, now),
    readFeatures(db, null, now),
  ])
  return { totals, snapshot, versions, features }
}

function reply(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...OPS_RESPONSE_HEADERS, 'content-type': PROMETHEUS_CONTENT_TYPE } })
}

export async function handleOpsMetrics(request: Request, env: OpsEnv, now: number): Promise<Response> {
  const access = checkOpsAccess(request, env)
  if (access === 'not_found') return reply(404, 'not found\n')
  if (access === 'unauthorized') return reply(401, 'unauthorized\n')

  try {
    return reply(200, renderPrometheusText(opsMetricFamilies(await readOpsMetricsData(env.DB, now))))
  } catch (error) {
    console.error('ops metrics query failed', { error: error instanceof Error ? error.message : 'unknown' })
    return reply(503, 'unavailable\n')
  }
}
