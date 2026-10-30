import { describe, expect, it } from 'vitest'
import { opsMetricFamilies, type OpsMetricsData } from '../../server/ops/opsMetrics'
import { renderPrometheusText } from '../../server/ops/prometheusText'

const EMPTY: OpsMetricsData = { totals: [], snapshot: [], versions: [], features: [] }
const METRIC_NAME = /^discordmute_telemetry_[a-z_]+$/
const ALLOWED_LABELS = new Set(['mode', 'type', 'version', 'feature'])

const render = (data: Partial<OpsMetricsData>) => renderPrometheusText(opsMetricFamilies({ ...EMPTY, ...data }))

describe('opsMetricFamilies', () => {
  it('names every family with the discordmute_telemetry_ prefix and uses only low-cardinality labels', () => {
    const families = opsMetricFamilies({
      totals: [{ mode: 'hosted', metric: 'event.lobby', value: 1 }],
      snapshot: [],
      versions: [{ mode: 'hosted', kind: 'bot', version: '3.0.0', count: 1 }],
      features: [{ mode: 'hosted', feature: 'voiceRules', instances: 1 }],
    })
    for (const family of families) {
      expect(family.name).toMatch(METRIC_NAME)
      expect(family.type === 'counter').toBe(family.name.endsWith('_total'))
      for (const sample of family.samples) {
        for (const label of Object.keys(sample.labels ?? {})) expect(ALLOWED_LABELS).toContain(label)
      }
    }
  })

  it('writes zero counters and gauges for both modes when there is no data', () => {
    const text = render({})
    expect(text).toContain('discordmute_telemetry_games_muted_total{mode="self-host"} 0')
    expect(text).toContain('discordmute_telemetry_games_muted_total{mode="hosted"} 0')
    expect(text).toContain('discordmute_telemetry_instances{mode="hosted"} 0')
    expect(text).toContain('# TYPE discordmute_telemetry_plugin_events_total counter')
    expect(text).not.toContain('discordmute_telemetry_mute_latency_avg_seconds{')
  })

  it('maps the all-time counter sums, converting latency to seconds', () => {
    const text = render({
      totals: [
        { mode: 'self-host', metric: 'games_muted', value: 12 },
        { mode: 'self-host', metric: 'latency_ms_sum', value: 1500 },
        { mode: 'self-host', metric: 'latency_samples', value: 3 },
        { mode: 'hosted', metric: 'event.game-start', value: 4 },
        { mode: 'hosted', metric: 'unknown_metric', value: 9 },
      ],
    })
    expect(text).toContain('discordmute_telemetry_games_muted_total{mode="self-host"} 12')
    expect(text).toContain('discordmute_telemetry_mute_latency_seconds_total{mode="self-host"} 1.5')
    expect(text).toContain('discordmute_telemetry_mute_latency_samples_total{mode="self-host"} 3')
    expect(text).toContain('discordmute_telemetry_plugin_events_total{mode="hosted",type="game-start"} 4')
    expect(text).not.toContain('unknown_metric')
  })

  it('maps the snapshot, versions and features', () => {
    const text = render({
      snapshot: [
        {
          mode: 'self-host',
          instancesTotal: 5,
          instancesActive: 2,
          instancesRecent: 3,
          uniqueUsers: 40,
          activeGames: 1,
          guilds: 2,
          connectedPlugins: 4,
          latencyAvgMs: 120,
        },
      ],
      versions: [
        { mode: 'self-host', kind: 'bot', version: '3.0.0', count: 2 },
        { mode: 'self-host', kind: 'plugin', version: '3.0.0-beta.1', count: 6 },
        { mode: 'self-host', kind: 'amongUs', version: '2026.9.29', count: 7 },
      ],
      features: [{ mode: 'self-host', feature: 'linkOverview', instances: 2 }],
    })
    expect(text).toContain('discordmute_telemetry_instances{mode="self-host"} 5')
    expect(text).toContain('discordmute_telemetry_instances_active{mode="self-host"} 2')
    expect(text).toContain('discordmute_telemetry_unique_users{mode="self-host"} 40')
    expect(text).toContain('discordmute_telemetry_mute_latency_avg_seconds{mode="self-host"} 0.12')
    expect(text).toContain('discordmute_telemetry_bot_version_instances{mode="self-host",version="3.0.0"} 2')
    expect(text).toContain('discordmute_telemetry_plugin_version_sessions{mode="self-host",version="3.0.0-beta.1"} 6')
    expect(text).toContain('discordmute_telemetry_among_us_version_sessions{mode="self-host",version="2026.9.29"} 7')
    expect(text).toContain('discordmute_telemetry_feature_instances{mode="self-host",feature="linkOverview"} 2')
  })
})
