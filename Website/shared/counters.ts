export const COUNTER_KEYS = ['gamesMuted', 'uniqueUsers', 'activeGames', 'guilds'] as const
export type CounterKey = (typeof COUNTER_KEYS)[number]

export const PUBLIC_COUNTERS: Readonly<Record<CounterKey, boolean>> = {
  gamesMuted: true,
  uniqueUsers: true,
  activeGames: false,
  guilds: false,
}

export interface ModeCount {
  total: number
  selfHost: number
  hosted: number
}

export type AllStats = Record<CounterKey, ModeCount> & { updatedAt: number }
export type PublicStats = Partial<Record<CounterKey, ModeCount>> & { updatedAt: number }

export function visibleCounters(
  stats: AllStats,
  switches: Readonly<Record<CounterKey, boolean>> = PUBLIC_COUNTERS,
): PublicStats {
  const visible: PublicStats = { updatedAt: stats.updatedAt }
  for (const key of COUNTER_KEYS) {
    if (switches[key]) visible[key] = stats[key]
  }
  return visible
}
