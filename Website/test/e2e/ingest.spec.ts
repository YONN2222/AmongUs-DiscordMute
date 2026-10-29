import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { expect, test } from '@playwright/test'

const ORIGIN = 'http://127.0.0.1:8799'
const PATH = '/api/v1/telemetry'

function samplePacket() {
  const packet = JSON.parse(readFileSync(new URL('./packet.json', import.meta.url), 'utf8'))
  return { ...packet, packetId: crypto.randomUUID(), instanceId: crypto.randomUUID() }
}

test('accepts the sample packet', async ({ request }) => {
  const response = await request.post(`${ORIGIN}${PATH}`, {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify(samplePacket()),
  })
  expect(response.status()).toBe(202)
  expect(await response.json()).toEqual({ ok: true, status: 'accepted' })
})

test('answers 413 while an oversized chunked body is still streaming', async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error('no response before the body ended'))
    }, 10_000)
    const req = httpRequest(
      `${ORIGIN}${PATH}`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } },
      (response) => {
        clearTimeout(timer)
        resolve(response.statusCode ?? 0)
        response.resume()
        req.destroy()
      },
    )
    req.on('error', () => {})
    req.write(' '.repeat(9000))
  })
  expect(status).toBe(413)
})
