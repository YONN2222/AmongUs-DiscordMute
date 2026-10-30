import { parseStatsVisibility } from '#shared/statsVisibility'

export function useStatsVisible(): ComputedRef<boolean> {
  const config = useRuntimeConfig().public
  return computed(() => parseStatsVisibility(config.stats) === 'visible')
}
