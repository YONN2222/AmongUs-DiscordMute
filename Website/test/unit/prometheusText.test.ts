import { describe, expect, it } from 'vitest'
import { renderPrometheusText } from '../../server/ops/prometheusText'

describe('renderPrometheusText', () => {
  it('writes HELP and TYPE lines before the samples', () => {
    const text = renderPrometheusText([
      { name: 'demo_total', type: 'counter', help: 'Demo counter.', samples: [{ labels: { mode: 'hosted' }, value: 3 }] },
      { name: 'demo_gauge', type: 'gauge', help: 'Demo gauge.', samples: [{ value: 1.5 }] },
    ])
    expect(text).toBe(
      [
        '# HELP demo_total Demo counter.',
        '# TYPE demo_total counter',
        'demo_total{mode="hosted"} 3',
        '# HELP demo_gauge Demo gauge.',
        '# TYPE demo_gauge gauge',
        'demo_gauge 1.5',
        '',
      ].join('\n'),
    )
  })

  it('keeps HELP and TYPE for a family without samples', () => {
    expect(renderPrometheusText([{ name: 'empty', type: 'gauge', help: 'Empty.', samples: [] }])).toBe(
      '# HELP empty Empty.\n# TYPE empty gauge\n',
    )
  })

  it('escapes backslashes, quotes and newlines in label values', () => {
    const text = renderPrometheusText([
      { name: 'demo', type: 'gauge', help: 'Demo.', samples: [{ labels: { version: 'a\\b"c\nd' }, value: 1 }] },
    ])
    expect(text).toContain('demo{version="a\\\\b\\"c\\nd"} 1')
  })

  it('escapes backslashes and newlines in HELP', () => {
    const text = renderPrometheusText([{ name: 'demo', type: 'gauge', help: 'line\\one\ntwo', samples: [] }])
    expect(text).toContain('# HELP demo line\\\\one\\ntwo\n')
  })

  it('joins several labels with commas', () => {
    const text = renderPrometheusText([
      { name: 'demo', type: 'gauge', help: 'Demo.', samples: [{ labels: { mode: 'self-host', version: '3.0.0' }, value: 2 }] },
    ])
    expect(text).toContain('demo{mode="self-host",version="3.0.0"} 2')
  })

  it('writes special float values the Prometheus way', () => {
    const text = renderPrometheusText([
      { name: 'demo', type: 'gauge', help: 'Demo.', samples: [{ value: Number.NaN }, { value: Infinity }, { value: -Infinity }] },
    ])
    expect(text).toContain('demo NaN\ndemo +Inf\ndemo -Inf\n')
  })
})
