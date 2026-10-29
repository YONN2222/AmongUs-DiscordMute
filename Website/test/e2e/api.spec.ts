import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// A dedicated seeded server: the stats response is edge cached for 60 s, so the first read must come after the POST.
const INGEST_ORIGIN = 'http://localhost:8789'
const SEEDED_GAMES_TOTAL = 1234
const SEEDED_GAMES_SELF_HOST = 1000

const packet = JSON.parse(readFileSync(new URL('./packet.json', import.meta.url), 'utf8'))

test('POST valid packet returns 202 then stats gamesMuted increases by its delta', async ({ request }) => {
  const body = { ...packet, packetId: crypto.randomUUID(), instanceId: crypto.randomUUID() }
  const accepted = await request.post(`${INGEST_ORIGIN}/api/v1/telemetry`, {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify(body),
  })
  expect(accepted.status()).toBe(202)

  const after = await (await request.get(`${INGEST_ORIGIN}/api/v1/stats`)).json()
  expect(after.data.gamesMuted).toEqual({
    total: SEEDED_GAMES_TOTAL + body.deltas.gamesMuted,
    selfHost: SEEDED_GAMES_SELF_HOST + body.deltas.gamesMuted,
    hosted: SEEDED_GAMES_TOTAL - SEEDED_GAMES_SELF_HOST,
  })
})

test('GET /api/v1/stats has Cache-Control max-age=60', async ({ request }) => {
  const response = await request.get('/api/v1/stats')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('max-age=60')
})

test('old host redirect', async ({ request }) => {
  const response = await request.get('/privacy?x=1', {
    headers: { host: 'amongus-mute.yonn2222.com' },
    maxRedirects: 0,
  })
  test.skip(response.status() === 200, 'wrangler dev rewrites Host; covered by the canonical host unit test')
  expect(response.status()).toBe(301)
  expect(response.headers().location).toBe('https://mute.yonn2222.com/privacy?x=1')
})
