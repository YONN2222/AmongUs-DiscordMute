const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const DATA_TYPES = new Set(['application/json', 'application/ld+json'])

function needsHash(attrs: string): boolean {
  if (/\bsrc\s*=/i.test(attrs)) return false
  const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase() ?? ''
  return !DATA_TYPES.has(type)
}

async function sha256Source(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`
}

export async function contentSecurityPolicy(html: string): Promise<string> {
  const inline = [...html.matchAll(SCRIPT_TAG)].filter(([, attrs]) => needsHash(attrs ?? ''))
  const hashes = [...new Set(await Promise.all(inline.map(([, , code]) => sha256Source(code ?? ''))))]
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...hashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
