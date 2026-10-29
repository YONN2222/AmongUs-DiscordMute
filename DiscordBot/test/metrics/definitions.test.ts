import { AggregatorRegistry, Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { createClusterMetrics } from "../../src/Metrics/clusterMetrics";
import { createGatewayMetrics } from "../../src/Metrics/gatewayMetrics";

describe("metric definitions", () => {
    it("gateway metrics register with the discordmute_ prefix and report rss", async () => {
        const registry = new Registry();
        const metrics = createGatewayMetrics(registry);
        metrics.pluginEvents.inc({ type: "lobby" });
        const text = await registry.metrics();
        expect(text).toContain('discordmute_plugin_events_total{type="lobby"} 1');
        expect(text).toMatch(/discordmute_process_resident_memory_bytes\{process="gateway"\} \d+/);
    });

    it("cluster metrics read guild count and ping from the attached client", async () => {
        const registry = new Registry();
        const metrics = createClusterMetrics(registry, 2);
        metrics.attachClient({ guilds: { cache: { size: 9 } }, ws: { ping: 120 } });
        metrics.mutes.inc({ action: "mute" });
        metrics.muteLatency.observe(0.3);
        const text = await registry.metrics();
        expect(text).toContain("discordmute_guilds 9");
        expect(text).toContain('discordmute_cluster_guilds{cluster="2"} 9');
        expect(text).toContain('discordmute_cluster_ws_ping_seconds{cluster="2"} 0.12');
        expect(text).toContain('discordmute_process_resident_memory_bytes{process="cluster-2"}');
        expect(text).toContain('discordmute_mute_latency_seconds_bucket{le="0.5"} 1');
    });

    it("aggregating two clusters sums guilds and keeps the ping labels apart", async () => {
        const registries = [0, 1].map((id) => {
            const registry = new Registry();
            createClusterMetrics(registry, id).attachClient({ guilds: { cache: { size: 3 } }, ws: { ping: 50 } });
            return registry;
        });
        const jsons = await Promise.all(registries.map((registry) => registry.getMetricsAsJSON()));
        const text = await AggregatorRegistry.aggregate(jsons).metrics();
        expect(text).toContain("discordmute_guilds 6");
        expect(text).toContain('discordmute_cluster_ws_ping_seconds{cluster="0"} 0.05');
        expect(text).toContain('discordmute_cluster_ws_ping_seconds{cluster="1"} 0.05');
    });
});
