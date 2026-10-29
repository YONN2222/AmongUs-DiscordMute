import { describe, expect, it } from 'vitest'
import { canonicalRedirect } from '../../server/routing/canonical'

describe('canonicalRedirect', () => {
  it('redirects GET with path and query with 301', () => {
    expect(canonicalRedirect(new URL('https://amongus-mute.yonn2222.com/privacy?x=1'), 'GET')).toEqual({
      status: 301,
      location: 'https://mute.yonn2222.com/privacy?x=1',
    })
  })

  it('uses 301 for HEAD', () => {
    expect(canonicalRedirect(new URL('https://amongus-mute.yonn2222.com/'), 'HEAD')?.status).toBe(301)
  })

  it('uses 308 for POST', () => {
    expect(canonicalRedirect(new URL('https://amongus-mute.yonn2222.com/api/v1/telemetry'), 'POST')).toEqual({
      status: 308,
      location: 'https://mute.yonn2222.com/api/v1/telemetry',
    })
  })

  it('returns null for canonical host', () => {
    expect(canonicalRedirect(new URL('https://mute.yonn2222.com/terms'), 'GET')).toBeNull()
  })

  it('returns null for localhost', () => {
    expect(canonicalRedirect(new URL('http://localhost:8799/terms'), 'GET')).toBeNull()
  })

  it('returns null for unknown hosts', () => {
    expect(canonicalRedirect(new URL('https://example.com/'), 'GET')).toBeNull()
  })
})
