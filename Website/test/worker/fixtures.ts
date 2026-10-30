import type { TelemetryPacket } from '../../shared/telemetry/schema'

export function validPacket(overrides: Partial<TelemetryPacket> = {}): TelemetryPacket {
  return {
    schemaVersion: 1,
    packetId: crypto.randomUUID(),
    instanceId: crypto.randomUUID(),
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
    ...overrides,
  }
}
