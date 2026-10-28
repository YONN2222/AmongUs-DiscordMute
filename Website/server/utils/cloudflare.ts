import type { H3Event } from 'h3'

export function cloudflareEnv(event: H3Event): Env {
  const bindings = event.context.cloudflare?.env as Env | undefined
  if (!bindings) {
    throw createError({ statusCode: 500, statusMessage: 'Cloudflare bindings unavailable' })
  }
  return bindings
}
