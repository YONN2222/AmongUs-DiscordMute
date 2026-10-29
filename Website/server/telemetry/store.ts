import { MIN_INTERVAL_SECONDS } from '../../shared/telemetry/contract'
import type { TelemetryPacket } from '../../shared/telemetry/schema'

type RecordResult = 'accepted' | 'duplicate' | 'rate_limited'

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export async function getInstanceLastSeen(
  db: D1Database,
  instanceId: string,
): Promise<{ lastSeenAt: number; lastPacketId: string } | null> {
  const row = await db
    .prepare('SELECT last_seen_at, last_packet_id FROM instances WHERE instance_id = ?1')
    .bind(instanceId)
    .first<{ last_seen_at: number; last_packet_id: string }>()
  return row ? { lastSeenAt: row.last_seen_at, lastPacketId: row.last_packet_id } : null
}

function metricsOf(packet: TelemetryPacket): Array<[string, number]> {
  const { deltas, latency } = packet
  const events = Object.entries(deltas.events).map(
    ([name, value]): [string, number] => [`event.${name}`, value ?? 0],
  )
  const entries: Array<[string, number]> = [
    ['reports', 1],
    ['games_muted', deltas.gamesMuted],
    ['mutes', deltas.mutes],
    ['unmutes', deltas.unmutes],
    ['rate_limit_hits', deltas.rateLimitHits],
    ['latency_ms_sum', Math.round(latency.avgMs * latency.samples)],
    ['latency_samples', latency.samples],
    ...events,
  ]
  return entries.filter(([, value]) => value > 0)
}

const UPSERT_INSTANCE = `INSERT INTO instances (
  instance_id, mode, first_seen_at, last_seen_at, last_packet_id, bot_version,
  plugin_versions, among_us_versions, features, unique_users, active_games,
  guilds, connected_plugins, latency_avg_ms
) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
ON CONFLICT(instance_id) DO UPDATE SET
  last_seen_at = excluded.last_seen_at,
  last_packet_id = excluded.last_packet_id,
  bot_version = excluded.bot_version,
  plugin_versions = excluded.plugin_versions,
  among_us_versions = excluded.among_us_versions,
  features = excluded.features,
  unique_users = excluded.unique_users,
  active_games = excluded.active_games,
  guilds = excluded.guilds,
  connected_plugins = excluded.connected_plugins,
  latency_avg_ms = excluded.latency_avg_ms
WHERE instances.last_packet_id <> excluded.last_packet_id
  AND instances.last_seen_at <= excluded.last_seen_at - ?14`

// changes() reflects the previous statement in the batch. It is 0 when the
// instance upsert was skipped (duplicate or rate limited) and stays 0 down the
// chain, so a concurrent duplicate of an accepted packet cannot count twice.
const ADD_COUNTER = `INSERT INTO daily_counters (day, mode, metric, value)
SELECT ?1, i.mode, ?2, ?3 FROM instances i
WHERE i.instance_id = ?4 AND i.last_packet_id = ?5 AND i.last_seen_at = ?6 AND changes() > 0
ON CONFLICT(day, mode, metric) DO UPDATE SET value = value + excluded.value`

export async function recordPacket(
  db: D1Database,
  packet: TelemetryPacket,
  now: number,
): Promise<RecordResult> {
  const previous = await getInstanceLastSeen(db, packet.instanceId)
  if (previous?.lastPacketId === packet.packetId) return 'duplicate'

  const upsert = db.prepare(UPSERT_INSTANCE).bind(
    packet.instanceId,
    packet.mode,
    now,
    packet.packetId,
    packet.versions.bot,
    JSON.stringify(packet.versions.plugins),
    JSON.stringify(packet.versions.amongUs),
    JSON.stringify(packet.features),
    packet.gauges.uniqueUsers,
    packet.gauges.activeGames,
    packet.gauges.guilds,
    packet.gauges.connectedPlugins,
    packet.latency.avgMs,
    MIN_INTERVAL_SECONDS * 1000,
  )
  const day = utcDay(now)
  const counters = metricsOf(packet).map(([metric, value]) =>
    db.prepare(ADD_COUNTER).bind(day, metric, value, packet.instanceId, packet.packetId, now),
  )

  const results = await db.batch([upsert, ...counters])
  if ((results[0]?.meta.changes ?? 0) > 0) return 'accepted'

  const current = await getInstanceLastSeen(db, packet.instanceId)
  return current?.lastPacketId === packet.packetId ? 'duplicate' : 'rate_limited'
}
