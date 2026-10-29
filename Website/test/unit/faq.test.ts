import { describe, expect, it } from 'vitest'
import { FAQ, faqFor } from '../../app/content/faq'
import { HOSTED_STATUSES, hostedView } from '../../shared/hostedStatus'

const IDS = ['platforms', 'install', 'linking', 'muting', 'permissions', 'telemetry', 'cost', 'affiliation']
const range = (from: number, to: number) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
const SYMBOLS = new RegExp(`[${range(0x2190, 0x21ff)}${range(0x2700, 0x27bf)}${range(0x25a0, 0x25ff)}${range(0x2600, 0x26ff)}]`)

describe('FAQ', () => {
  it('faq ids are unique and match the fixed list', () => {
    const ids = FAQ.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(IDS)
  })

  it('hosted answer follows the status and sits after the install answer', () => {
    for (const status of HOSTED_STATUSES) {
      const view = hostedView(status, '1565436340114423808')
      const entries = faqFor(view)
      const ids = entries.map((entry) => entry.id)
      expect(ids.indexOf('hosted')).toBe(ids.indexOf('install') + 1)
      expect(entries.find((entry) => entry.id === 'hosted')?.answer).toBe(`${view.headline}. ${view.body}`)
      expect(entries).toHaveLength(FAQ.length + 1)
    }
  })

  it('telemetry answer mentions disableTelemetry', () => {
    expect(FAQ.find((entry) => entry.id === 'telemetry')?.answer).toContain('disableTelemetry: true')
  })

  it('no FAQ text contains characters from the Unicode arrows, dingbats or geometric shapes blocks', () => {
    expect(String.fromCodePoint(0x2192)).toMatch(SYMBOLS)
    for (const entry of FAQ) {
      expect(entry.question).not.toMatch(SYMBOLS)
      expect(entry.answer).not.toMatch(SYMBOLS)
    }
  })

  it('cost answer names GPLv3 and affiliation answer names Innersloth', () => {
    expect(FAQ.find((entry) => entry.id === 'cost')?.answer).toContain('GPLv3')
    expect(FAQ.find((entry) => entry.id === 'affiliation')?.answer).toContain('Innersloth')
  })
})
