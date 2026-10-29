import { describe, expect, it } from 'vitest'
import { readBodyLimited } from '../../server/telemetry/body'

function chunkedStream(chunkSize: number, chunks: number) {
  let pulls = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      if (pulls > chunks) controller.close()
      else controller.enqueue(new Uint8Array(chunkSize).fill(97))
    },
    cancel() {
      cancelled = true
    },
  })
  return { stream, pulls: () => pulls, cancelled: () => cancelled }
}

const post = (body: BodyInit | null) =>
  new Request('http://x/', { method: 'POST', body, duplex: 'half' } as RequestInit)

describe('readBodyLimited', () => {
  it('returns bytes under the limit', async () => {
    const result = await readBodyLimited(post('{"a":1}'), 8192)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('{"a":1}')
  })

  it('returns bytes exactly at the limit', async () => {
    const { stream } = chunkedStream(1024, 8)
    const result = await readBodyLimited(post(stream), 8192)
    expect((result as Uint8Array).byteLength).toBe(8192)
  })

  it('returns an empty array for a request without body', async () => {
    const result = await readBodyLimited(post(null), 8192)
    expect((result as Uint8Array).byteLength).toBe(0)
  })

  it('returns too_large for a 9000-byte stream without Content-Length', async () => {
    const source = chunkedStream(1000, 9)
    const request = post(source.stream)
    expect(request.headers.get('content-length')).toBeNull()
    expect(await readBodyLimited(request, 8192)).toBe('too_large')
    expect(source.pulls()).toBeLessThanOrEqual(10)
    expect(source.cancelled()).toBe(true)
  })

  it('stops reading an endless stream once over the limit', async () => {
    const source = chunkedStream(1000, Number.POSITIVE_INFINITY)
    expect(await readBodyLimited(post(source.stream), 8192)).toBe('too_large')
    expect(source.pulls()).toBeLessThanOrEqual(10)
  })
})
