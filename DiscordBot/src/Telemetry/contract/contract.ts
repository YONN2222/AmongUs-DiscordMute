/**
 * Mirrors of this contract and of schema.ts must use zod 4 (z.uuid,
 * z.partialRecord, z.toJSONSchema). The 16-key limit on version maps is a
 * refine in zod and a maxProperties entry in telemetry.schema.json, so the
 * JSON file alone is not a complete validator.
 */
export const TELEMETRY_PATH = '/api/v1/telemetry'
export const MAX_BODY_BYTES = 8192
export const MIN_INTERVAL_SECONDS = 60
export const HOSTED_AUTH_HEADER = 'authorization'

export type TelemetryStatus = 'accepted' | 'duplicate'
export type TelemetryError =
  | 'invalid'
  | 'unsupported_media_type'
  | 'too_large'
  | 'unauthorized'
  | 'implausible'
  | 'rate_limited'
  | 'unavailable'
export type TelemetryResult =
  | { ok: true; status: TelemetryStatus }
  | { ok: false; error: TelemetryError }

export const TELEMETRY_HTTP: Readonly<Record<TelemetryStatus | TelemetryError, number>> = {
  accepted: 202,
  duplicate: 200,
  invalid: 400,
  unauthorized: 401,
  too_large: 413,
  unsupported_media_type: 415,
  implausible: 422,
  rate_limited: 429,
  unavailable: 503,
}

/**
 * Bot retry rule: retry only when the error is in RETRYABLE or the request
 * failed at the network level, and resend the same packetId. On any other
 * error, drop the deltas of that window.
 */
export const RETRYABLE: ReadonlySet<string> = new Set(['rate_limited', 'unavailable'])
