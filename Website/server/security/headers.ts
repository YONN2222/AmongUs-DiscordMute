import { API_CSP, SECURITY_HEADERS } from './csp'

// For responses the custom Worker entry serves before Nitro, which never see routeRules.
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  headers.set('Content-Security-Policy', API_CSP)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
