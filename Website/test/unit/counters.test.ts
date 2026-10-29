import { describe, expect, it } from 'vitest'
import { PUBLIC_COUNTERS, visibleCounters, type AllStats } from '../../shared/counters'

const split = (selfHost: number, hosted: number) => ({ total: selfHost + hosted, selfHost, hosted })

const all: AllStats = {
  gamesMuted: split(10, 5),
  uniqueUsers: split(7, 3),
  activeGames: split(2, 1),
  guilds: split(4, 4),
  updatedAt: 1_000,
}

describe('visibleCounters', () => {
  it('default switch exposes only gamesMuted and uniqueUsers', () => {
    expect(PUBLIC_COUNTERS.activeGames).toBe(false)
    expect(Object.keys(visibleCounters(all)).sort()).toEqual(['gamesMuted', 'uniqueUsers', 'updatedAt'])
  })

  it('keeps the per-mode breakdown', () => {
    expect(visibleCounters(all).gamesMuted).toEqual({ total: 15, selfHost: 10, hosted: 5 })
  })

  it('custom switch exposes activeGames', () => {
    const shown = visibleCounters(all, { ...PUBLIC_COUNTERS, activeGames: true })
    expect(Object.keys(shown).sort()).toEqual(['activeGames', 'gamesMuted', 'uniqueUsers', 'updatedAt'])
    expect(shown.activeGames).toEqual({ total: 3, selfHost: 2, hosted: 1 })
  })
})
