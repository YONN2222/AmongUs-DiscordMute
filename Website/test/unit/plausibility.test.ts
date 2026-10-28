import { describe, expect, it } from 'vitest'
import type { TelemetryPacket } from '../../shared/telemetry/schema'
import { checkPlausibility, windowSeconds } from '../../server/telemetry/plausibility'

function packet(overrides: Partial<TelemetryPacket> = {}): TelemetryPacket {
  return {
    schemaVersion: 1,
    packetId: '3f1c9a52-7d1e-4a43-9b0a-6a2f1f0c8e11',
    instanceId: '8b6f2f0e-5c3d-4f55-8d3e-1c2a7e9b4d10',
    mode: 'self-host',
    versions: { bot: '1.0.0', plugins: { '1.2.0': 3, '1.1.0': 1 }, amongUs: { '2026.3.25': 4 } },
    gauges: { uniqueUsers: 12, activeGames: 2, guilds: 3, connectedPlugins: 4 },
    deltas: {
      gamesMuted: 5,
      mutes: 40,
      unmutes: 38,
      rateLimitHits: 0,
      events: { lobby: 2, 'game-start': 2, 'meeting-start': 6 },
    },
    latency: { avgMs: 142.5, samples: 78 },
    features: { linkOverview: 3, voiceRules: 1 },
    ...overrides,
  }
}

const withGauges = (g: Partial<TelemetryPacket['gauges']>, mode: TelemetryPacket['mode'] = 'self-host') =>
  packet({ mode, gauges: { ...packet().gauges, ...g } })
const withDeltas = (d: Partial<TelemetryPacket['deltas']>, mode: TelemetryPacket['mode'] = 'self-host') =>
  packet({ mode, deltas: { ...packet().deltas, ...d } })

describe('windowSeconds', () => {
  const now = 1_800_000_000_000
  it('uses the first-packet window without history', () => {
    expect(windowSeconds(null, now)).toBe(600)
  })
  it('clamps to the minimum', () => {
    expect(windowSeconds(now - 5_000, now)).toBe(60)
  })
  it('clamps to the maximum', () => {
    expect(windowSeconds(now - 7_200_000, now)).toBe(3600)
  })
  it('returns the elapsed seconds in range', () => {
    expect(windowSeconds(now - 300_000, now)).toBe(300)
  })
  it('treats a last-seen timestamp in the future as the minimum', () => {
    expect(windowSeconds(now + 60_000, now)).toBe(60)
  })
})

describe('checkPlausibility', () => {
  it('accepts a normal self-host packet over 300 s', () => {
    expect(checkPlausibility(packet(), 300)).toEqual({ ok: true })
  })

  it('rejects self-host guilds 1001 but accepts hosted guilds 1001', () => {
    expect(checkPlausibility(withGauges({ guilds: 1001 }), 300)).toEqual({ ok: false, reason: 'gauges.guilds' })
    expect(checkPlausibility(withGauges({ guilds: 1001 }, 'hosted'), 300)).toEqual({ ok: true })
  })

  it('rejects gauges above their caps', () => {
    expect(checkPlausibility(withGauges({ uniqueUsers: 100_001 }), 300)).toEqual({
      ok: false,
      reason: 'gauges.uniqueUsers',
    })
    expect(checkPlausibility(withGauges({ activeGames: 1001, connectedPlugins: 1001 }), 300)).toEqual({
      ok: false,
      reason: 'gauges.activeGames',
    })
    expect(checkPlausibility(withGauges({ connectedPlugins: 1001 }), 300)).toMatchObject({ ok: false })
  })

  it('rejects a backlog of games muted', () => {
    expect(checkPlausibility(withDeltas({ gamesMuted: 1000 }), 3600)).toEqual({
      ok: false,
      reason: 'deltas.gamesMuted',
    })
  })

  it('scales delta caps with the window and rounds up', () => {
    expect(checkPlausibility(withDeltas({ gamesMuted: 10 }), 60)).toEqual({ ok: true })
    expect(checkPlausibility(withDeltas({ gamesMuted: 11 }), 60)).toMatchObject({ ok: false })
    expect(checkPlausibility(withDeltas({ gamesMuted: 1 }), 1)).toEqual({ ok: true })
  })

  it('applies the hosted rates', () => {
    expect(checkPlausibility(withDeltas({ gamesMuted: 1000 }, 'hosted'), 3600)).toEqual({ ok: true })
  })

  it('rejects per-event deltas over the cap', () => {
    const result = checkPlausibility(withDeltas({ events: { lobby: 601 } }), 60)
    expect(result).toEqual({ ok: false, reason: 'deltas.events.lobby' })
  })

  it('rejects mutes and rate limit hits over the cap', () => {
    expect(checkPlausibility(withDeltas({ mutes: 3001 }), 60)).toMatchObject({ ok: false, reason: 'deltas.mutes' })
    expect(checkPlausibility(withDeltas({ rateLimitHits: 3001 }), 60)).toEqual({
      ok: false,
      reason: 'deltas.rateLimitHits',
    })
  })

  it('rejects activeGames > connectedPlugins', () => {
    expect(checkPlausibility(withGauges({ activeGames: 5, connectedPlugins: 4 }), 300)).toEqual({
      ok: false,
      reason: 'gauges.activeGames',
    })
  })

  it('rejects feature count > guilds', () => {
    expect(checkPlausibility(packet({ features: { linkOverview: 4 } }), 300)).toEqual({
      ok: false,
      reason: 'features.linkOverview',
    })
  })

  it('rejects plugin version counts > connectedPlugins', () => {
    const p = packet({ versions: { bot: '1.0.0', plugins: { '1.0.0': 3, '1.1.0': 2 }, amongUs: {} } })
    expect(checkPlausibility(p, 300)).toEqual({ ok: false, reason: 'versions.plugins' })
  })

  it('rejects Among Us version counts > connectedPlugins', () => {
    const p = packet({ versions: { bot: '1.0.0', plugins: {}, amongUs: { '2026.3.25': 5 } } })
    expect(checkPlausibility(p, 300)).toEqual({ ok: false, reason: 'versions.amongUs' })
  })

  it('rejects latency samples > mutes + unmutes', () => {
    expect(checkPlausibility(packet({ latency: { avgMs: 10, samples: 79 } }), 300)).toEqual({
      ok: false,
      reason: 'latency.samples',
    })
  })

  it('rejects avgMs > 0 with zero samples', () => {
    expect(checkPlausibility(packet({ latency: { avgMs: 5, samples: 0 } }), 300)).toEqual({
      ok: false,
      reason: 'latency.avgMs',
    })
  })
})
