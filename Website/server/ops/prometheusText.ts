// Prometheus text exposition format 0.0.4.
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

export type MetricType = 'counter' | 'gauge'
export type Sample = { labels?: Record<string, string>; value: number }
export type MetricFamily = { name: string; help: string; type: MetricType; samples: Sample[] }

const escapeHelp = (text: string) => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
const escapeLabelValue = (text: string) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

function formatValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return '+Inf'
  if (value === -Infinity) return '-Inf'
  return String(value)
}

function formatLabels(labels: Record<string, string> = {}): string {
  const pairs = Object.entries(labels).map(([name, value]) => `${name}="${escapeLabelValue(value)}"`)
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`
}

export function renderPrometheusText(families: readonly MetricFamily[]): string {
  const lines = families.flatMap((family) => [
    `# HELP ${family.name} ${escapeHelp(family.help)}`,
    `# TYPE ${family.name} ${family.type}`,
    ...family.samples.map((sample) => `${family.name}${formatLabels(sample.labels)} ${formatValue(sample.value)}`),
  ])
  return `${lines.join('\n')}\n`
}
