import type { PublicStats } from '#shared/counters'

type StatsResponse = { ok: true; data: PublicStats } | { ok: false; error: string }

export function usePublicStats() {
  const { data, error } = useFetch<StatsResponse>('/api/v1/stats', { key: 'public-stats' })
  const stats = computed<PublicStats | null>(() => (data.value?.ok ? data.value.data : null))
  const unavailable = computed(() => Boolean(error.value) || !stats.value)
  return { stats, unavailable }
}
