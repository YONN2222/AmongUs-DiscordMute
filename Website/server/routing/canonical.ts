import { CANONICAL_ORIGIN, REDIRECT_HOSTS } from '../../shared/site'

export function canonicalRedirect(url: URL, method: string): { status: 301 | 308; location: string } | null {
  if (!REDIRECT_HOSTS.includes(url.hostname)) return null
  const status = method === 'GET' || method === 'HEAD' ? 301 : 308
  return { status, location: CANONICAL_ORIGIN + url.pathname + url.search }
}
