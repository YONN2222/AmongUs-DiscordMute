import { ACTIVE_WINDOW_MS, ESTABLISHED_INSTANCE_MS } from '../stats/stats'
import { bearerMatches } from '../telemetry/ingest'
import { utcDay } from '../telemetry/store'

export const OPS_TELEMETRY_PATH = '/api/v1/ops/telemetry'
export const OPS_VIEWS = ['daily', 'snapshot', 'versions', 'features'] as const
export const OPS_DEFAULT_DAYS = 90
export const OPS_MAX_DAYS = 400
export const OPS_RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000

const MIN_TOKEN_LENGTH = 32
const DAY_MS = 24 * 3600 * 1000
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const OPS_MODES = ['self-host', 'hosted'] as const
export const OPS_RESPONSE_HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }

export type OpsMode = (typeof OPS_MODES)[number]

export type OpsQuery = { view: (typeof OPS_VIEWS)[number]; mode: OpsMode | null; from: string; to: string }

export type OpsRow =
  | { day: string; mode: string; metric: string; value: number }
  | {
      mode: string
      instancesTotal: number
      instancesActive: number
      instancesRecent: number
      uniqueUsers: number
      activeGames: number
      guilds: number
      connectedPlugins: number
      latencyAvgMs: number | null
    }
  | { mode: string; kind: 'bot' | 'plugin' | 'amongUs'; version: string; count: number }
  | { mode: string; feature: string; instances: number }

type DailyRow = Extract<OpsRow, { day: string }>
export type SnapshotRow = Extract<OpsRow, { instancesTotal: number }>
export type VersionRow = Extract<OpsRow, { kind: string }>
export type FeatureRow = Extract<OpsRow, { feature: string }>
export type TotalRow = { mode: string; metric: string; value: number }

const isView = (raw: string): raw is OpsQuery['view'] => (OPS_VIEWS as readonly string[]).includes(raw)
const isMode = (raw: string): raw is OpsMode => (OPS_MODES as readonly string[]).includes(raw)

// Returns the UTC midnight of a real calendar day written as YYYY-MM-DD, or null.
function parseDay(raw: string): number | null {
  if (!DAY_PATTERN.test(raw)) return null
  const ms = Date.parse(`${raw}T00:00:00Z`)
  return Number.isNaN(ms) || utcDay(ms) !== raw ? null : ms
}

export function parseOpsQuery(url: URL, now: number): OpsQuery | 'invalid' {
  const params = url.searchParams
  const view = params.get('view') ?? 'daily'
  const rawMode = params.get('mode')
  if (!isView(view) || (rawMode !== null && !isMode(rawMode))) return 'invalid'

  const rawTo = params.get('to')
  const to = rawTo === null ? parseDay(utcDay(now)) : parseDay(rawTo)
  const rawFrom = params.get('from')
  const from = rawFrom === null && to !== null ? to - (OPS_DEFAULT_DAYS - 1) * DAY_MS : parseDay(rawFrom ?? '')
  if (from === null || to === null || from > to) return 'invalid'
  if ((to - from) / DAY_MS + 1 > OPS_MAX_DAYS) return 'invalid'

  return { view, mode: rawMode as OpsMode | null, from: utcDay(from), to: utcDay(to) }
}

const round1 = (value: number) => Math.round(value * 10) / 10
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byDayModeMetric = (a: DailyRow, b: DailyRow) =>
  compareText(a.day, b.day) || compareText(a.mode, b.mode) || compareText(a.metric, b.metric)

function withLatencyAverages(rows: readonly DailyRow[]): DailyRow[] {
  const totals = new Map<string, { day: string; mode: string; sum: number; samples: number }>()
  for (const row of rows) {
    if (row.metric !== 'latency_ms_sum' && row.metric !== 'latency_samples') continue
    const key = `${row.day}|${row.mode}`
    const total = totals.get(key) ?? { day: row.day, mode: row.mode, sum: 0, samples: 0 }
    if (row.metric === 'latency_ms_sum') total.sum = row.value
    else total.samples = row.value
    totals.set(key, total)
  }
  const averages: DailyRow[] = [...totals.values()]
    .filter((total) => total.samples > 0)
    .map((total) => ({ day: total.day, mode: total.mode, metric: 'latency_avg_ms', value: round1(total.sum / total.samples) }))
  return [...rows, ...averages].sort(byDayModeMetric)
}

async function readDaily(db: D1Database, q: OpsQuery): Promise<OpsRow[]> {
  const { results } = await db
    .prepare(
      `SELECT day, mode, metric, value FROM daily_counters
       WHERE day >= ?1 AND day <= ?2 AND (?3 IS NULL OR mode = ?3)`,
    )
    .bind(q.from, q.to, q.mode)
    .all<DailyRow>()
  return withLatencyAverages(results)
}

// All-time sums of the daily counters, one row per mode and metric.
export async function readTotals(db: D1Database): Promise<TotalRow[]> {
  const { results } = await db
    .prepare('SELECT mode, metric, SUM(value) AS value FROM daily_counters GROUP BY mode, metric ORDER BY mode, metric')
    .all<TotalRow>()
  return results
}

export async function readSnapshot(db: D1Database, mode: OpsMode | null, now: number): Promise<SnapshotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT mode,
         COUNT(*) AS instancesTotal,
         COALESCE(SUM(last_seen_at >= ?1), 0) AS instancesActive,
         COALESCE(SUM(last_seen_at >= ?2), 0) AS instancesRecent,
         COALESCE(SUM(CASE WHEN last_seen_at - first_seen_at >= ?3 THEN unique_users END), 0) AS uniqueUsers,
         COALESCE(SUM(CASE WHEN last_seen_at >= ?1 THEN active_games END), 0) AS activeGames,
         COALESCE(SUM(CASE WHEN last_seen_at >= ?1 THEN guilds END), 0) AS guilds,
         COALESCE(SUM(CASE WHEN last_seen_at >= ?1 THEN connected_plugins END), 0) AS connectedPlugins,
         AVG(CASE WHEN last_seen_at >= ?1 AND latency_avg_ms > 0 THEN latency_avg_ms END) AS latencyAvgMs
       FROM instances
       WHERE ?4 IS NULL OR mode = ?4
       GROUP BY mode ORDER BY mode`,
    )
    .bind(now - ACTIVE_WINDOW_MS, now - OPS_RECENT_WINDOW_MS, ESTABLISHED_INSTANCE_MS, mode)
    .all<SnapshotRow>()
  return results.map((row) => ({ ...row, latencyAvgMs: row.latencyAvgMs === null ? null : round1(row.latencyAvgMs) }))
}

export async function readVersions(db: D1Database, mode: OpsMode | null, now: number): Promise<VersionRow[]> {
  const recent = 'i.last_seen_at >= ?1 AND (?2 IS NULL OR i.mode = ?2)'
  const { results } = await db
    .prepare(
      `SELECT i.mode AS mode, 'bot' AS kind, i.bot_version AS version, COUNT(*) AS count
         FROM instances i WHERE ${recent} GROUP BY i.mode, i.bot_version
       UNION ALL
       SELECT i.mode, 'plugin', j.key, SUM(j.value)
         FROM instances i, json_each(i.plugin_versions) j WHERE ${recent} GROUP BY i.mode, j.key
       UNION ALL
       SELECT i.mode, 'amongUs', j.key, SUM(j.value)
         FROM instances i, json_each(i.among_us_versions) j WHERE ${recent} GROUP BY i.mode, j.key
       ORDER BY mode, kind, version`,
    )
    .bind(now - OPS_RECENT_WINDOW_MS, mode)
    .all<VersionRow>()
  return results
}

export async function readFeatures(db: D1Database, mode: OpsMode | null, now: number): Promise<FeatureRow[]> {
  const { results } = await db
    .prepare(
      `SELECT i.mode AS mode, j.key AS feature, COUNT(*) AS instances
       FROM instances i, json_each(i.features) j
       WHERE i.last_seen_at >= ?1 AND (?2 IS NULL OR i.mode = ?2)
         AND (j.type = 'true' OR (j.type IN ('integer', 'real') AND j.value > 0))
       GROUP BY i.mode, j.key ORDER BY i.mode, j.key`,
    )
    .bind(now - OPS_RECENT_WINDOW_MS, mode)
    .all<FeatureRow>()
  return results
}

export function readOpsView(db: D1Database, q: OpsQuery, now: number): Promise<OpsRow[]> {
  switch (q.view) {
    case 'daily':
      return readDaily(db, q)
    case 'snapshot':
      return readSnapshot(db, q.mode, now)
    case 'versions':
      return readVersions(db, q.mode, now)
    case 'features':
      return readFeatures(db, q.mode, now)
  }
}

function reply(status: number, body: { ok: true; data: OpsRow[] } | { ok: false; error: string }): Response {
  return Response.json(body, { status, headers: OPS_RESPONSE_HEADERS })
}

// The token is an optional secret, so it is not part of the generated Env type.
export type OpsEnv = Pick<Env, 'DB'> & { OPS_STATS_TOKEN?: string }

export type OpsAccess = 'granted' | 'not_found' | 'unauthorized'

// The ops endpoints do not exist until a long enough OPS_STATS_TOKEN is set.
export function checkOpsAccess(request: Request, env: OpsEnv): OpsAccess {
  const token = env.OPS_STATS_TOKEN
  if (!token || token.length < MIN_TOKEN_LENGTH) return 'not_found'
  return bearerMatches(request.headers.get('authorization'), token) ? 'granted' : 'unauthorized'
}

export async function handleOpsTelemetry(request: Request, env: OpsEnv, now: number): Promise<Response> {
  const access = checkOpsAccess(request, env)
  if (access === 'not_found') return reply(404, { ok: false, error: 'not_found' })
  if (access === 'unauthorized') return reply(401, { ok: false, error: 'unauthorized' })

  const query = parseOpsQuery(new URL(request.url), now)
  if (query === 'invalid') return reply(400, { ok: false, error: 'invalid' })

  try {
    return reply(200, { ok: true, data: await readOpsView(env.DB, query, now) })
  } catch (error) {
    console.error('ops telemetry query failed', { error: error instanceof Error ? error.message : 'unknown' })
    return reply(503, { ok: false, error: 'unavailable' })
  }
}
