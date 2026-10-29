import { describe, expect, it } from 'vitest'
import { parseStatsVisibility } from '../../shared/statsVisibility'

describe('parseStatsVisibility', () => {
  it('stats visibility falls back to visible', () => {
    for (const raw of [undefined, null, '', 'HIDDEN', 'off', 0, false, {}]) expect(parseStatsVisibility(raw)).toBe('visible')
  })

  it('accepts visible and hidden', () => {
    expect(parseStatsVisibility('visible')).toBe('visible')
    expect(parseStatsVisibility('hidden')).toBe('hidden')
  })
})
