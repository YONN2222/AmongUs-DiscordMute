import { visibleCounters, type AllStats, type ModeCount } from '../../shared/counters'

export const ACTIVE_WINDOW_MS = 15 * 60 * 1000
export const STATS_CACHE_CONTROL = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300'
const STATS_CACHE_KEY = 'https://mute.yonn2222.com/api/v1/stats'

interface ModeRow {
  mode: string
  games?: number
  users?: number
  activeGames?: number
  guilds?: number
}

const emptyCount = (): ModeCount => ({ total: 0, selfHost: 0, hosted: 0 })

function toCount(rows: readonly ModeRow[], pick: (row: ModeRow) => number | undefined): ModeCount {
  const count = emptyCount()
  for (const row of rows) {
    const value = pick(row) ?? 0
    if (row.mode === 'self-host') count.selfHost += value
    else if (row.mode === 'hosted') count.hosted += value
    else continue
    count.total += value
  }
  return count
}

export async function readStats(db: D1Database, now: number): Promise<AllStats> {
  const [games, users, live] = await db.batch<ModeRow>([
    db.prepare(
      "SELECT mode, COALESCE(SUM(value), 0) AS games FROM daily_counters WHERE metric = 'games_muted' GROUP BY mode",
    ),
    db.prepare('SELECT mode, COALESCE(SUM(unique_users), 0) AS users FROM instances GROUP BY mode'),
    db
      .prepare(
        `SELECT mode, COALESCE(SUM(active_games), 0) AS activeGames, COALESCE(SUM(guilds), 0) AS guilds
         FROM instances WHERE last_seen_at >= ?1 GROUP BY mode`,
      )
      .bind(now - ACTIVE_WINDOW_MS),
  ])
  return {
    gamesMuted: toCount(games!.results, (row) => row.games),
    uniqueUsers: toCount(users!.results, (row) => row.users),
    activeGames: toCount(live!.results, (row) => row.activeGames),
    guilds: toCount(live!.results, (row) => row.guilds),
    updatedAt: now,
  }
}

type WaitUntil = (promise: Promise<unknown>) => void

function edgeCache(): Cache | undefined {
  return typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: Cache }).default
}

function cacheFailure(error: unknown): void {
  console.error('stats cache failed', { error: error instanceof Error ? error.message : 'unknown' })
}

export async function handleStats(
  env: Env,
  now: number,
  cache: Cache | undefined = edgeCache(),
  waitUntil?: WaitUntil,
): Promise<Response> {
  try {
    const cached = await cache?.match(STATS_CACHE_KEY).catch((error: unknown) => {
      cacheFailure(error)
      return undefined
    })
    if (cached) return cached
    const stats = await readStats(env.DB, now)
    const response = Response.json(
      { ok: true, data: visibleCounters(stats) },
      { headers: { 'cache-control': STATS_CACHE_CONTROL } },
    )
    if (cache) {
      const write = cache.put(STATS_CACHE_KEY, response.clone()).catch(cacheFailure)
      waitUntil?.(write)
    }
    return response
  } catch (error) {
    console.error('stats query failed', { error: error instanceof Error ? error.message : 'unknown' })
    return Response.json({ ok: false, error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
