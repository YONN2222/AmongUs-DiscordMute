import { type Client, RESTEvents } from "discord.js";
import { Counter, Gauge, Histogram, type Registry } from "prom-client";
import type { VoiceAdapter } from "../Mute/MuteService";
import { MetricNames, MUTE_LATENCY_BUCKETS, type MuteAction } from "./metricNames";

export interface ClusterClientStats {
    guilds: { cache: { size: number } };
    ws: { ping: number };
}

export interface ClusterMetrics {
    mutes: Counter<"action">;
    muteFailures: Counter;
    muteLatency: Histogram;
    rateLimitHits: Counter;
    guilds: Gauge;
    clusterGuilds: Gauge<"cluster">;
    clusterWsPing: Gauge<"cluster">;
    processResidentMemory: Gauge<"process">;
    attachClient(client: ClusterClientStats): void;
}

export function createClusterMetrics(registry: Registry, clusterId: number): ClusterMetrics {
    const registers = [registry];
    const cluster = String(clusterId);
    let client: ClusterClientStats | undefined;

    return {
        mutes: new Counter<"action">({
            name: MetricNames.mutes,
            help: "Voice mute and unmute operations",
            labelNames: ["action"] satisfies ["action"],
            registers,
        }),
        muteFailures: new Counter({
            name: MetricNames.muteFailures,
            help: "Failed voice mute and unmute operations",
            registers,
        }),
        muteLatency: new Histogram({
            name: MetricNames.muteLatency,
            help: "Latency of voice mute and unmute operations",
            buckets: MUTE_LATENCY_BUCKETS,
            registers,
        }),
        rateLimitHits: new Counter({
            name: MetricNames.rateLimitHits,
            help: "Discord rate limit hits",
            registers,
        }),
        guilds: new Gauge({
            name: MetricNames.guilds,
            help: "Guilds served by this cluster",
            registers,
            collect() {
                if (client) this.set(client.guilds.cache.size);
            },
        }),
        clusterGuilds: new Gauge<"cluster">({
            name: MetricNames.clusterGuilds,
            help: "Guilds served per cluster",
            labelNames: ["cluster"],
            registers,
            collect() {
                if (client) this.set({ cluster }, client.guilds.cache.size);
            },
        }),
        clusterWsPing: new Gauge<"cluster">({
            name: MetricNames.clusterWsPing,
            help: "Discord gateway websocket ping per cluster",
            labelNames: ["cluster"],
            aggregator: "first",
            registers,
            collect() {
                if (client && client.ws.ping >= 0) this.set({ cluster }, client.ws.ping / 1000);
            },
        }),
        processResidentMemory: new Gauge<"process">({
            name: MetricNames.processResidentMemory,
            help: "Resident set size of the process in bytes",
            labelNames: ["process"],
            registers,
            collect() {
                this.set({ process: `cluster-${clusterId}` }, process.memoryUsage().rss);
            },
        }),
        attachClient(next) {
            client = next;
        },
    };
}

/**
 * Wraps the voice adapter so every successful server mute or unmute is counted and timed, and every failure is
 * counted, without touching the mute logic. Deafen-only changes are neither counted nor timed, so the latency
 * sample count always equals the mute and unmute count.
 */
export function instrumentVoiceAdapter(inner: VoiceAdapter, metrics: ClusterMetrics): VoiceAdapter {
    return {
        membersInChannel: (guildId, channelId) => inner.membersInChannel(guildId, channelId),
        findVoiceMember: (guildId, discordId) => inner.findVoiceMember(guildId, discordId),
        async setVoiceState(guildId, discordId, patch) {
            const stopTimer = metrics.muteLatency.startTimer();
            try {
                await inner.setVoiceState(guildId, discordId, patch);
            } catch (error) {
                metrics.muteFailures.inc();
                throw error;
            }
            if (patch.mute === undefined) return;
            stopTimer();
            const action: MuteAction = patch.mute ? "mute" : "unmute";
            metrics.mutes.inc({ action });
        },
    };
}

export function registerDiscordMetrics(client: Client, metrics: ClusterMetrics): void {
    client.rest.on(RESTEvents.RateLimited, () => metrics.rateLimitHits.inc());
    metrics.attachClient(client);
}
