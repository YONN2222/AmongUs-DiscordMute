import { describe, expect, it } from 'vitest'
import { LEGAL_UPDATED_AT, PRIVACY_SECTIONS, TERMS_SECTIONS } from '../../app/content/legal'
import { TELEMETRY_EVENT_NAMES, TELEMETRY_FEATURES } from '../../shared/telemetry/schema'

const range = (from: number, to: number) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
const SYMBOLS = new RegExp(`[${range(0x2190, 0x21ff)}${range(0x2700, 0x27bf)}${range(0x25a0, 0x25ff)}${range(0x2600, 0x26ff)}]`)

const PRIVACY_IDS = ['controller', 'website', 'telemetry', 'hosted-bot', 'self-host', 'retention', 'rights', 'changes']
const TERMS_IDS = ['service', 'acceptable-use', 'hosted-availability', 'software-license', 'no-affiliation', 'warranty', 'liability', 'changes', 'contact']

const text = (sections: typeof PRIVACY_SECTIONS) => sections.flatMap((s) => [s.heading, ...s.body]).join('\n')
const section = (sections: typeof PRIVACY_SECTIONS, id: string) => text(sections.filter((s) => s.id === id))

describe('legal content', () => {
  it('privacy lists every telemetry event name and feature', () => {
    const telemetry = section(PRIVACY_SECTIONS, 'telemetry')
    for (const name of [...TELEMETRY_EVENT_NAMES, ...TELEMETRY_FEATURES]) expect(telemetry).toContain(name)
  })

  it('privacy mentions disableTelemetry', () => {
    expect(section(PRIVACY_SECTIONS, 'telemetry')).toContain('disableTelemetry: true')
  })

  it('privacy mentions the audit log retention of 180 days', () => {
    expect(section(PRIVACY_SECTIONS, 'hosted-bot')).toMatch(/audit log/i)
    expect(section(PRIVACY_SECTIONS, 'hosted-bot')).toContain('180 days')
    expect(section(PRIVACY_SECTIONS, 'retention')).toContain('180 days')
  })

  it('privacy mentions owner id storage', () => {
    const hosted = section(PRIVACY_SECTIONS, 'hosted-bot')
    expect(hosted).toMatch(/owner/i)
    expect(hosted).toMatch(/server name/i)
    expect(hosted).toMatch(/member count/i)
  })

  it('privacy states IPs are not stored', () => {
    expect(section(PRIVACY_SECTIONS, 'website')).toMatch(/never (stored|written)/i)
  })

  it('privacy sections keep the fixed order', () => {
    expect(PRIVACY_SECTIONS.map((s) => s.id)).toEqual(PRIVACY_IDS)
  })

  it('terms contain section ids in the fixed order', () => {
    expect(TERMS_SECTIONS.map((s) => s.id)).toEqual(TERMS_IDS)
  })

  it('no section text mentions Impressum, an email address or governing law', () => {
    for (const sections of [PRIVACY_SECTIONS, TERMS_SECTIONS]) {
      expect(text(sections)).not.toMatch(/impressum/i)
      expect(text(sections)).not.toMatch(/@[a-z0-9-]+\./i)
      expect(text(sections)).not.toMatch(/governing law|jurisdiction/i)
    }
  })

  it('operator is referenced only by link', () => {
    expect(section(PRIVACY_SECTIONS, 'controller')).toContain('https://yonn2222.com')
    expect(section(TERMS_SECTIONS, 'contact')).toContain('https://yonn2222.com')
  })

  it('has an ISO update date', () => {
    expect(LEGAL_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('no legal text contains Unicode arrows, dingbats or geometric shapes', () => {
    expect(String.fromCodePoint(0x2192)).toMatch(SYMBOLS)
    for (const sections of [PRIVACY_SECTIONS, TERMS_SECTIONS]) expect(text(sections)).not.toMatch(SYMBOLS)
  })
})
