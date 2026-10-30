import { randomUUID } from "node:crypto";
import { MetricNames } from "../Metrics/MetricNames";
import type { ProcessSnapshot } from "../Metrics/MetricsCollector";
import { MAX_BODY_BYTES } from "./Contract/contract";
import {
    TELEMETRY_EVENT_NAMES,
    TELEMETRY_FEATURES,
    type TelemetryEventName,
    type TelemetryFeature,
    type TelemetryMode,
    type TelemetryPacket,
    telemetryPacketSchema,
    VERSION_PATTERN,
} from "./Contract/schema";

const MAX_LATENCY_MS = 30000;
const FALLBACK_VERSION = "0";
const MAX_VERSION_LENGTH = 32;
const LEADING_NUMBERS = /^[0-9]+(\.[0-9]+){0,3}/;

const COUNTER_NAMES = new Set<string>([
    MetricNames.pluginEvents,
    MetricNames.gamesMuted,
    MetricNames.mutes,
    MetricNames.rateLimitHits,
    `${MetricNames.muteLatency}_count`,
    `${MetricNames.muteLatency}_sum`,
]);

export interface TelemetryBuilderDeps {
    instanceId: string;
    mode: TelemetryMode;
    botVersion: string;
    countLinkedUsers: () => Promise<number>;
}

type Labels = Record<string, string | number | undefined>;
type Sample = { key: string; name: string; labels: Labels; value: number };

const ID_LIKE_NUMBER = /\d{7,}/;

/** Anything that does not fit the website pattern keeps only its numeric prefix, or becomes "0". Long digit runs (ids) always become "0". */
export function normalizeVersion(raw: string): string {
    const trimmed = raw.trim().replace(/^v/i, "");
    if (ID_LIKE_NUMBER.test(trimmed)) return FALLBACK_VERSION;
    if (trimmed.length <= MAX_VERSION_LENGTH && VERSION_PATTERN.test(trimmed)) return trimmed;
    return trimmed.match(LEADING_NUMBERS)?.[0] ?? FALLBACK_VERSION;
}

function samplesOf(snapshots: ProcessSnapshot[]): Sample[] {
    const samples: Sample[] = [];
    for (const snapshot of snapshots) {
        for (const metric of snapshot.metrics) {
            for (const entry of metric.values) {
                const name = (entry as { metricName?: string }).metricName ?? metric.name;
                if (!COUNTER_NAMES.has(name)) continue;
                const labels = (entry.labels ?? {}) as Labels;
                const labelKey = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
                samples.push({ key: `${snapshot.source}|${name}|${labelKey}`, name, labels, value: entry.value });
            }
        }
    }
    return samples;
}

function gaugeEntries(snapshots: ProcessSnapshot[], name: string): { labels: Labels; value: number }[] {
    return snapshots.flatMap((snapshot) =>
        snapshot.metrics
            .filter((metric) => metric.name === name)
            .flatMap((metric) =>
                metric.values.map((entry) => ({ labels: (entry.labels ?? {}) as Labels, value: entry.value })),
            ),
    );
}

const sumGauge = (snapshots: ProcessSnapshot[], name: string): number =>
    gaugeEntries(snapshots, name).reduce((total, entry) => total + entry.value, 0);

function versionCounts(snapshots: ProcessSnapshot[], label: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of gaugeEntries(snapshots, MetricNames.pluginSessions)) {
        if (entry.value <= 0) continue;
        const version = normalizeVersion(String(entry.labels[label] ?? ""));
        counts[version] = (counts[version] ?? 0) + Math.round(entry.value);
    }
    return counts;
}

const toCount = (value: number): number => Math.max(0, Math.round(value));

/** Servers per feature, summed over the clusters. Only the contract's feature keys are emitted, never above the guild count. */
function featureCounts(snapshots: ProcessSnapshot[], guilds: number): Partial<Record<TelemetryFeature, number>> {
    const totals = new Map<string, number>();
    for (const entry of gaugeEntries(snapshots, MetricNames.featureGuilds)) {
        const feature = String(entry.labels.feature ?? "");
        totals.set(feature, (totals.get(feature) ?? 0) + entry.value);
    }
    const features: Partial<Record<TelemetryFeature, number>> = {};
    for (const feature of TELEMETRY_FEATURES) {
        const count = Math.min(toCount(totals.get(feature) ?? 0), guilds);
        if (count > 0) features[feature] = count;
    }
    return features;
}

export class TelemetryBuilder {
    private baseline = new Map<string, number>();

    constructor(private readonly deps: TelemetryBuilderDeps) {}

    resetBaseline(snapshots: ProcessSnapshot[]): void {
        this.baseline = new Map(samplesOf(snapshots).map((sample) => [sample.key, sample.value]));
    }

    async build(snapshots: ProcessSnapshot[]): Promise<TelemetryPacket> {
        const samples = samplesOf(snapshots);
        const totals = new Map<string, number>();
        const nextBaseline = new Map(this.baseline);
        for (const sample of samples) {
            const previous = this.baseline.get(sample.key);
            const delta = previous === undefined || sample.value < previous ? sample.value : sample.value - previous;
            const label = String(sample.labels.type ?? sample.labels.action ?? "");
            const totalKey = `${sample.name}|${label}`;
            totals.set(totalKey, (totals.get(totalKey) ?? 0) + delta);
            nextBaseline.set(sample.key, sample.value);
        }
        const total = (name: string, label = ""): number => totals.get(`${name}|${label}`) ?? 0;

        const events: Partial<Record<TelemetryEventName, number>> = {};
        for (const event of TELEMETRY_EVENT_NAMES) {
            const count = toCount(total(MetricNames.pluginEvents, event));
            if (count > 0) events[event] = count;
        }

        const mutes = toCount(total(MetricNames.mutes, "mute"));
        const unmutes = toCount(total(MetricNames.mutes, "unmute"));
        const latencyCount = toCount(total(`${MetricNames.muteLatency}_count`));
        const latencySum = total(`${MetricNames.muteLatency}_sum`);
        const latencySamples = Math.min(latencyCount, mutes + unmutes);
        const avgMs =
            latencySamples === 0
                ? 0
                : Math.min(MAX_LATENCY_MS, Math.round(((latencySum * 1000) / latencyCount) * 10) / 10);

        const guilds = toCount(sumGauge(snapshots, MetricNames.guilds));
        const connectedPlugins = toCount(sumGauge(snapshots, MetricNames.pluginsConnected));
        const activeGames = Math.min(toCount(sumGauge(snapshots, MetricNames.activeGames)), connectedPlugins);

        const features = featureCounts(snapshots, guilds);

        const packet = telemetryPacketSchema.parse({
            schemaVersion: 1,
            packetId: randomUUID(),
            instanceId: this.deps.instanceId,
            mode: this.deps.mode,
            versions: {
                bot: normalizeVersion(this.deps.botVersion),
                plugins: versionCounts(snapshots, "plugin_version"),
                amongUs: versionCounts(snapshots, "game_version"),
            },
            gauges: {
                uniqueUsers: toCount(await this.deps.countLinkedUsers()),
                activeGames,
                guilds,
                connectedPlugins,
            },
            deltas: {
                gamesMuted: toCount(total(MetricNames.gamesMuted)),
                mutes,
                unmutes,
                rateLimitHits: toCount(total(MetricNames.rateLimitHits)),
                events,
            },
            latency: { avgMs, samples: latencySamples },
            features,
        });
        if (JSON.stringify(packet).length > MAX_BODY_BYTES) throw new Error("telemetry packet exceeds MAX_BODY_BYTES");

        this.baseline = nextBaseline;
        return packet;
    }
}
