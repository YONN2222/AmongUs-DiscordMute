export const STATS_VISIBILITIES = ['visible', 'hidden'] as const
export type StatsVisibility = (typeof STATS_VISIBILITIES)[number]

export const DEFAULT_STATS_VISIBILITY: StatsVisibility = 'visible'

export function parseStatsVisibility(raw: unknown): StatsVisibility {
  return STATS_VISIBILITIES.find((visibility) => visibility === raw) ?? DEFAULT_STATS_VISIBILITY
}
