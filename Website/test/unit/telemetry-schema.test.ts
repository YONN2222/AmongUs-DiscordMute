import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { telemetryPacketSchema } from '../../shared/telemetry/schema'

function validPacket() {
  return {
    schemaVersion: 1,
    packetId: '3f1c9a52-7d1e-4a43-9b0a-6a2f1f0c8e11',
    instanceId: '8b6f2f0e-5c3d-4f55-8d3e-1c2a7e9b4d10',
    mode: 'self-host',
    versions: {
      bot: '1.0.0',
      plugins: { '1.2.0': 3, '1.1.0': 1 },
      amongUs: { '2026.3.25': 4 },
    },
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
  }
}

const parse = (value: unknown) => telemetryPacketSchema.safeParse(value).success

describe('telemetry packet schema', () => {
  it('accepts a valid packet', () => {
    expect(parse(validPacket())).toBe(true)
  })

  it('rejects unknown top-level key', () => {
    expect(parse({ ...validPacket(), guildId: '123' })).toBe(false)
  })

  it('rejects unknown nested key', () => {
    const gauges = { ...validPacket().gauges, serverName: 'x' }
    expect(parse({ ...validPacket(), gauges })).toBe(false)
    const base = validPacket()
    const deltas = { ...base.deltas, events: { ...base.deltas.events, 'player-name': 1 } }
    expect(parse({ ...base, deltas })).toBe(false)
  })

  it('rejects non-uuid instanceId', () => {
    expect(parse({ ...validPacket(), instanceId: 'not-a-uuid' })).toBe(false)
  })

  it('rejects schemaVersion 2', () => {
    expect(parse({ ...validPacket(), schemaVersion: 2 })).toBe(false)
  })

  it('accepts release version strings', () => {
    const base = validPacket()
    for (const v of ['3.0.0', '2025.10.20', '3.1.0-beta.1', '3.1.0-rc', '7']) {
      expect(parse({ ...base, versions: { ...base.versions, bot: v, plugins: { [v]: 1 } } })).toBe(true)
    }
  })

  it('rejects versions that are not numeric releases', () => {
    const base = validPacket()
    const bad = ['my server 1.0', 'Alice', '3.0.0-AlicesBot', '3.0.0-alicesbot', '3.0.0-beta.alice','1.2.3.4.5', '1'.repeat(33), `3.0.0-${'a'.repeat(16)}`, '']
    for (const v of bad) {
      expect(parse({ ...base, versions: { ...base.versions, bot: v } })).toBe(false)
      expect(parse({ ...base, versions: { ...base.versions, plugins: { [v]: 1 } } })).toBe(false)
      expect(parse({ ...base, versions: { ...base.versions, amongUs: { [v]: 1 } } })).toBe(false)
    }
  })

  it('rejects more than 16 amongUs version keys', () => {
    const base = validPacket()
    const amongUs = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`2025.1.${i}`, 1]))
    expect(parse({ ...base, versions: { ...base.versions, amongUs } })).toBe(false)
  })

  it('rejects oversized and fractional counts in gauges, events and features', () => {
    const base = validPacket()
    for (const bad of [Number.MAX_SAFE_INTEGER + 1, 2.5, Number.NaN]) {
      expect(parse({ ...base, gauges: { ...base.gauges, guilds: bad } })).toBe(false)
      expect(parse({ ...base, deltas: { ...base.deltas, events: { lobby: bad } } })).toBe(false)
      expect(parse({ ...base, features: { serverLog: bad } })).toBe(false)
    }
    expect(parse({ ...base, gauges: { ...base.gauges, guilds: Number.MAX_SAFE_INTEGER } })).toBe(true)
  })

  it('rejects unknown features key', () => {
    expect(parse({ ...validPacket(), features: { telemetry: 1 } })).toBe(false)
  })

  it('rejects NaN and negative avgMs', () => {
    const base = validPacket()
    expect(parse({ ...base, latency: { avgMs: Number.NaN, samples: 1 } })).toBe(false)
    expect(parse({ ...base, latency: { avgMs: -1, samples: 1 } })).toBe(false)
  })

  it('emits the version key limit in the json schema', () => {
    expect(JSON.stringify(z.toJSONSchema(telemetryPacketSchema))).toContain('"maxProperties":16')
  })

  it('rejects more than 16 plugin version keys', () => {
    const base = validPacket()
    const plugins = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`1.0.${i}`, 1]))
    expect(parse({ ...base, versions: { ...base.versions, plugins } })).toBe(false)
    const ok = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`1.0.${i}`, 1]))
    expect(parse({ ...base, versions: { ...base.versions, plugins: ok } })).toBe(true)
  })

  it('rejects negative or fractional counts', () => {
    const base = validPacket()
    expect(parse({ ...base, deltas: { ...base.deltas, mutes: -1 } })).toBe(false)
    expect(parse({ ...base, deltas: { ...base.deltas, mutes: 1.5 } })).toBe(false)
  })

  it('rejects mode other than self-host/hosted', () => {
    expect(parse({ ...validPacket(), mode: 'cloud' })).toBe(false)
    expect(parse({ ...validPacket(), mode: 'hosted' })).toBe(true)
  })

  it('rejects latency above 30000 ms', () => {
    expect(parse({ ...validPacket(), latency: { avgMs: 30001, samples: 1 } })).toBe(false)
  })

  it('json schema file is current', () => {
    const file = JSON.parse(readFileSync(new URL('../../shared/telemetry/telemetry.schema.json', import.meta.url), 'utf8'))
    expect(file).toEqual(z.toJSONSchema(telemetryPacketSchema))
  })
})
