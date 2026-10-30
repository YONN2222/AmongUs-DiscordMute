import { env, exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('reaches the local D1 database', async () => {
  const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>()
  expect(row?.one).toBe(1)
})

it('answers unknown routes with 404', async () => {
  const response = await exports.default.fetch('http://x/nope')
  expect(response.status).toBe(404)
})
