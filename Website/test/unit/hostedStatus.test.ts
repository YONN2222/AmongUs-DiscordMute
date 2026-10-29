import { describe, expect, it } from 'vitest'
import { HOSTED_STATUSES, hostedView, parseHostedStatus } from '../../shared/hostedStatus'
import { hostedInviteUrl } from '../../shared/site'

const CLIENT_ID = '1565436340114423808'
const range = (from: number, to: number) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
const SYMBOLS = new RegExp(`[${range(0x2190, 0x21ff)}${range(0x2700, 0x27bf)}${range(0x25a0, 0x25ff)}${range(0x2600, 0x26ff)}]`)

describe('parseHostedStatus', () => {
  it('falls back to coming-soon', () => {
    for (const raw of [undefined, null, '', 'AVAILABLE', 'online', 42, {}]) expect(parseHostedStatus(raw)).toBe('coming-soon')
  })

  it('accepts every known status', () => {
    for (const status of HOSTED_STATUSES) expect(parseHostedStatus(status)).toBe(status)
  })
})

describe('hostedView', () => {
  it('available renders the invite url', () => {
    const view = hostedView('available', CLIENT_ID)
    expect(view.status).toBe('available')
    expect(view.badge).toBe('Hosted')
    expect(view.inviteUrl).toBe(hostedInviteUrl(CLIENT_ID))
    expect(view.cta).toEqual({ label: 'Add the bot', href: hostedInviteUrl(CLIENT_ID) })
  })

  it('available without client id behaves like coming-soon', () => {
    for (const clientId of [null, undefined, '', '  ', 'not-an-id']) {
      expect(hostedView('available', clientId)).toEqual(hostedView('coming-soon', clientId))
    }
  })

  it('coming-soon and unavailable never render an invite link', () => {
    for (const status of ['coming-soon', 'unavailable'] as const) {
      const view = hostedView(status, CLIENT_ID)
      expect(view.inviteUrl).toBeNull()
      expect(view.cta).toEqual({ label: 'Self-host now', href: '/#setup' })
      expect(JSON.stringify(view)).not.toContain('discord.com')
    }
  })

  it('has its own badge per status', () => {
    expect(hostedView('coming-soon', CLIENT_ID).badge).toBe('Coming soon')
    expect(hostedView('unavailable', CLIENT_ID).badge).toBe('Currently unavailable')
  })

  it('unavailable promises an automatic reconnect and points to self-hosting', () => {
    const view = hostedView('unavailable', CLIENT_ID)
    expect(view.body).toMatch(/reconnect automatically/)
    expect(view.body).toMatch(/self-hosting/i)
  })

  it('no text contains Unicode arrows, dingbats or geometric shapes', () => {
    for (const status of HOSTED_STATUSES) {
      const view = hostedView(status, CLIENT_ID)
      for (const text of [view.badge, view.headline, view.body, view.cta.label]) expect(text).not.toMatch(SYMBOLS)
    }
  })
})
