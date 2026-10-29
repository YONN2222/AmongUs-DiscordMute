import { describe, expect, it } from 'vitest'
import { formatCount } from '../../app/utils/formatCount'

describe('formatCount', () => {
  it('formats zero', () => {
    expect(formatCount(0)).toBe('0')
  })

  it('groups thousands', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})
