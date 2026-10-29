import {
  HOSTED_AUTH_HEADER,
  MAX_BODY_BYTES,
  MIN_INTERVAL_SECONDS,
  TELEMETRY_HTTP,
  type TelemetryError,
  type TelemetryResult,
} from '../../shared/telemetry/contract'
import { telemetryPacketSchema, type TelemetryPacket } from '../../shared/telemetry/schema'
import { readBodyLimited } from './body'
import { limiterKey } from './client-key'
import { checkPlausibility, windowSeconds } from './plausibility'
import { getInstanceLastSeen, recordPacket } from './store'

const LIMITER_RETRY_SECONDS = 60

// The DOM and webworker libs lack the Workers-only timingSafeEqual.
type WorkersSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean
}

class Unavailable extends Error {}

function reply(result: TelemetryResult, headers?: HeadersInit): Response {
  return Response.json(result, { status: TELEMETRY_HTTP[result.ok ? result.status : result.error], headers })
}

const fail = (error: TelemetryError, headers?: HeadersInit) => reply({ ok: false, error }, headers)
const retryAfter = (seconds: number) => ({ 'retry-after': String(seconds) })

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

async function allowedBy(limiter: RateLimit, name: string, key: string): Promise<boolean> {
  try {
    return (await limiter.limit({ key })).success
  } catch (error) {
    console.error('telemetry limiter failed', { limiter: name, error: errorName(error) })
    throw new Unavailable()
  }
}

async function fromStore<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    console.error('telemetry store failed', { error: message })
    throw new Unavailable()
  }
}

async function readPacket(request: Request): Promise<TelemetryPacket | 'too_large' | null> {
  let bytes: Uint8Array | 'too_large'
  try {
    bytes = await readBodyLimited(request, MAX_BODY_BYTES)
  } catch {
    return null
  }
  if (bytes === 'too_large') return bytes
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  const parsed = telemetryPacketSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function bearerMatches(header: string | null, token: string): boolean {
  if (!token || header === null) return false
  const subtle = crypto.subtle as WorkersSubtleCrypto
  const encoder = new TextEncoder()
  const actual = encoder.encode(header)
  const expected = encoder.encode(`Bearer ${token}`)
  if (actual.byteLength !== expected.byteLength) {
    subtle.timingSafeEqual(expected, expected)
    return false
  }
  return subtle.timingSafeEqual(actual, expected)
}

async function ingestPacket(packet: TelemetryPacket, env: Env, key: string, now: number): Promise<Response> {
  const previous = await fromStore(() => getInstanceLastSeen(env.DB, packet.instanceId))
  if (previous && previous.mode !== packet.mode) {
    return fail(packet.mode === 'self-host' ? 'unauthorized' : 'invalid')
  }
  if (previous?.lastPacketId === packet.packetId) return reply({ ok: true, status: 'duplicate' })

  const plausibility = checkPlausibility(packet, windowSeconds(previous?.lastSeenAt ?? null, now))
  if (!plausibility.ok) {
    console.warn('telemetry rejected', { reason: plausibility.reason, mode: packet.mode })
    return fail('implausible')
  }

  if (previous === null && !(await allowedBy(env.NEW_INSTANCE_LIMITER, 'new_instance', key))) {
    return fail('rate_limited', retryAfter(LIMITER_RETRY_SECONDS))
  }

  const result = await fromStore(() => recordPacket(env.DB, packet, now, previous))
  if (result === 'rate_limited') return fail('rate_limited', retryAfter(MIN_INTERVAL_SECONDS))
  return reply({ ok: true, status: result })
}

async function runPipeline(request: Request, env: Env, now: number): Promise<Response> {
  const key = limiterKey(request.headers.get('cf-connecting-ip') ?? 'unknown')
  if (!(await allowedBy(env.INGEST_LIMITER, 'ingest', key))) {
    return fail('rate_limited', retryAfter(LIMITER_RETRY_SECONDS))
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) return fail('unsupported_media_type')
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return fail('too_large')

  const packet = await readPacket(request)
  if (packet === 'too_large') return fail('too_large')
  if (!packet) return fail('invalid')

  if (packet.mode === 'hosted' && !bearerMatches(request.headers.get(HOSTED_AUTH_HEADER), env.HOSTED_TELEMETRY_TOKEN)) {
    return fail('unauthorized')
  }

  return ingestPacket(packet, env, key, now)
}

export async function handleIngest(request: Request, env: Env, now: number): Promise<Response> {
  try {
    return await runPipeline(request, env, now)
  } catch (error) {
    if (!(error instanceof Unavailable)) console.error('telemetry ingest failed', { error: errorName(error) })
    return fail('unavailable')
  }
}
