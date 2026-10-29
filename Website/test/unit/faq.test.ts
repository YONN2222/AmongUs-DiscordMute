import { describe, expect, it } from 'vitest'
import { FAQ } from '../../app/content/faq'

const IDS = ['platforms', 'install', 'linking', 'muting', 'permissions', 'telemetry', 'cost', 'affiliation']
const range = (from: number, to: number) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
const SYMBOLS = new RegExp(`[${range(0x2190, 0x21ff)}${range(0x2700, 0x27bf)}${range(0x25a0, 0x25ff)}${range(0x2600, 0x26ff)}]`)

describe('FAQ', () => {
  it('faq ids are unique and match the fixed list', () => {
    const ids = FAQ.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(IDS)
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
