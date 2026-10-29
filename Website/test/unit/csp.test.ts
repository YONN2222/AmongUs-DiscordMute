import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../../server/security/csp'

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`

describe('contentSecurityPolicy', () => {
  it('allows only self for every fetch directive', async () => {
    const csp = await contentSecurityPolicy('<html></html>')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("font-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toMatch(/https?:/)
    expect(csp).not.toContain('unsafe-eval')
  })

  it('hashes inline executable scripts', async () => {
    const inline = 'window.__NUXT__={};'
    const csp = await contentSecurityPolicy(`<head><script>${inline}</script><script type="module" src="/_nuxt/a.js"></script></head>`)
    expect(csp).toContain(`script-src 'self' ${sha(inline)}`)
  })

  it('hashes inline import maps', async () => {
    const map = '{"imports":{"#entry":"/_nuxt/entry.js"}}'
    const csp = await contentSecurityPolicy(`<script type="importmap">${map}</script>`)
    expect(csp).toContain(`script-src 'self' ${sha(map)}`)
  })

  it('ignores JSON data scripts', async () => {
    const csp = await contentSecurityPolicy('<script type="application/json" id="__NUXT_DATA__">[1]</script>')
    expect(csp).toContain("script-src 'self';")
  })
})
