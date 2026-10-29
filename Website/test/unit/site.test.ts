import { describe, expect, it } from 'vitest'
import { HOSTED_BOT_PERMISSIONS, hostedInviteUrl } from '../../shared/site'

describe('hostedInviteUrl', () => {
  it('builds the oauth url with the permission integer', () => {
    const url = new URL(hostedInviteUrl('1565436340114423808'))
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('1565436340114423808')
    expect(url.searchParams.get('scope')).toBe('bot applications.commands')
    expect(url.searchParams.get('permissions')).toBe(HOSTED_BOT_PERMISSIONS)
    expect(HOSTED_BOT_PERMISSIONS).toBe('146877440')
  })
})
