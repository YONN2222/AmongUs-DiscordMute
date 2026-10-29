import { describe, expect, it } from 'vitest'
import { OPS_MAX_DAYS, parseOpsQuery, type OpsQuery } from '../../server/ops/opsTelemetry'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const parse = (search: string) => parseOpsQuery(new URL(`https://x/api/v1/ops/telemetry${search}`), NOW)

describe('parseOpsQuery', () => {
  it('defaults to the last 90 days', () => {
    expect(parse('?view=daily')).toEqual<OpsQuery>({ view: 'daily', mode: null, from: '2026-08-01', to: '2026-10-29' })
  })

  it('defaults the view to daily', () => {
    expect(parse('')).toMatchObject({ view: 'daily' })
  })

  it('rejects from after to', () => {
    expect(parse('?view=daily&from=2026-10-29&to=2026-10-28')).toBe('invalid')
  })

  it('rejects a 401-day range', () => {
    expect(parse('?view=daily&from=2025-09-24&to=2026-10-29')).toBe('invalid')
  })

  it('accepts a range of exactly the maximum number of days', () => {
    expect(OPS_MAX_DAYS).toBe(400)
    expect(parse('?view=daily&from=2025-09-25&to=2026-10-29')).toMatchObject({ from: '2025-09-25', to: '2026-10-29' })
  })

  it('rejects an unknown view', () => {
    expect(parse('?view=instances')).toBe('invalid')
  })

  it('rejects an unknown mode', () => {
    expect(parse('?view=daily&mode=cloud')).toBe('invalid')
  })

  it('accepts mode hosted', () => {
    expect(parse('?view=snapshot&mode=hosted')).toMatchObject({ view: 'snapshot', mode: 'hosted' })
  })

  it('rejects dates that are not YYYY-MM-DD or do not exist', () => {
    for (const bad of ['2026-1-5', '20261005', '2026-02-30', 'yesterday', '']) {
      expect(parse(`?view=daily&from=${bad}`), bad).toBe('invalid')
    }
  })

  it('anchors a lone from on today', () => {
    expect(parse('?view=daily&from=2026-10-01')).toMatchObject({ from: '2026-10-01', to: '2026-10-29' })
  })
})
