import { canonicalRedirect } from '../routing/canonical'

export default defineEventHandler((event) => {
  const redirect = canonicalRedirect(getRequestURL(event), event.method)
  if (redirect) return sendRedirect(event, redirect.location, redirect.status)
})
