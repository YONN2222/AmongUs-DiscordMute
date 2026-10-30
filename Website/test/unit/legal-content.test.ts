import { describe, expect, it } from 'vitest'
import { LEGAL_UPDATED_AT, PRIVACY_SECTIONS, TERMS_SECTIONS } from '../../app/content/legal'
import { TELEMETRY_EVENT_NAMES, TELEMETRY_FEATURES } from '../../shared/telemetry/schema'

const range = (from: number, to: number) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
const SYMBOLS = new RegExp(`[${range(0x2190, 0x21ff)}${range(0x2700, 0x27bf)}${range(0x25a0, 0x25ff)}${range(0x2600, 0x26ff)}]`)

const PRIVACY_IDS = ['controller', 'website', 'analytics', 'telemetry', 'hosted-bot', 'self-host', 'retention', 'rights', 'changes']
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

  it('privacy mentions friend codes for relinking and nicknames kept during a game', () => {
    const hosted = section(PRIVACY_SECTIONS, 'hosted-bot')
    expect(hosted).toMatch(/friend code/i)
    expect(hosted).toMatch(/link .*again/i)
    expect(hosted).toMatch(/original server nickname/i)
    expect(hosted).toMatch(/puts it back when the game ends/i)
  })

  it('privacy says audit entries of a removal include the reason given', () => {
    expect(section(PRIVACY_SECTIONS, 'hosted-bot')).toMatch(/reason the operator gave/i)
  })

  it('privacy covers the hosted operational log, the mute record and open link requests', () => {
    const hosted = section(PRIVACY_SECTIONS, 'hosted-bot')
    expect(hosted).toMatch(/operational log/i)
    expect(hosted).toMatch(/in-game names/i)
    expect(hosted).toMatch(/muted, deafened or renamed/i)
    expect(hosted).toMatch(/link phrase is open/i)
    expect(section(PRIVACY_SECTIONS, 'retention')).toMatch(/operational logs.*30 days/i)
    expect(section(PRIVACY_SECTIONS, 'retention')).toMatch(/5 minutes/)
  })

  it('privacy names Cloudflare as processor for plugin connections to the hosted bot', () => {
    const hosted = section(PRIVACY_SECTIONS, 'hosted-bot')
    expect(hosted).toContain('Cloudflare, Inc.')
    expect(hosted).toContain('Cloudflare Tunnel')
  })

  it('privacy says server data is deleted 7 days after the bot was removed', () => {
    expect(section(PRIVACY_SECTIONS, 'hosted-bot')).toMatch(/deleted 7 days later/i)
    expect(section(PRIVACY_SECTIONS, 'retention')).toMatch(/7 days after it was removed/i)
  })

  it('privacy states IPs are not stored', () => {
    expect(section(PRIVACY_SECTIONS, 'website')).toMatch(/never (stored|written)/i)
  })

  it('privacy describes the self-hosted analytics and session recorder for both sites', () => {
    const analytics = section(PRIVACY_SECTIONS, 'analytics')
    expect(analytics).toContain('https://umami.yonn2222.com')
    expect(analytics).toContain('https://docs.mute.yonn2222.com')
    expect(analytics).toMatch(/sets no cookies/i)
    expect(analytics).toMatch(/does not store your IP address/i)
    expect(analytics).toMatch(/session recorder/i)
    expect(analytics).toMatch(/masked and not recorded/i)
    expect(analytics).toMatch(/retention period the operator has set/i)
    expect(analytics).toContain('Article 6(1)(f) GDPR')
    expect(section(PRIVACY_SECTIONS, 'website')).not.toMatch(/runs no analytics/i)
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
