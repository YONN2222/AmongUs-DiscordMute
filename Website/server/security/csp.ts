import { UMAMI_ORIGIN } from '../../shared/analytics'

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const NUXT_PAYLOAD = /^\s*window\.__NUXT__\s*=/

export interface RenderParts {
  head: readonly string[]
  bodyPrepend: readonly string[]
  bodyAppend: readonly string[]
}

function isFrameworkScript(attrs: string, code: string): boolean {
  if (/\bsrc\s*=/i.test(attrs)) return false
  const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase()
  if (type === 'importmap') return true
  return (type === undefined || type === 'module' || type === 'text/javascript') && NUXT_PAYLOAD.test(code)
}

async function sha256Source(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`
}

export function buildPolicy(scriptHashes: readonly string[] = []): string {
  return [
    "default-src 'self'",
    ['script-src', "'self'", UMAMI_ORIGIN, ...scriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${UMAMI_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

// Only the head and body-wrapper parts Nuxt emits are scanned, never the rendered app markup,
// and only the import map and the window.__NUXT__ payload are allowed, so injected scripts stay blocked.
export async function contentSecurityPolicy(parts: RenderParts): Promise<string> {
  const html = [...parts.head, ...parts.bodyPrepend, ...parts.bodyAppend].join('\n')
  const trusted = [...html.matchAll(SCRIPT_TAG)].filter(([, attrs, code]) => isFrameworkScript(attrs ?? '', code ?? ''))
  const hashes = [...new Set(await Promise.all(trusted.map(([, , code]) => sha256Source(code ?? ''))))]
  return buildPolicy(hashes)
}

// Responses that are JSON only (telemetry ingest) load nothing.
export const API_CSP = "default-src 'none'; frame-ancestors 'none'"

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}
