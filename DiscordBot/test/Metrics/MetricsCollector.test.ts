import { Counter, Gauge, Registry } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import {
    type ClusterSnapshotSource,
    GalacticSnapshotSource,
    MetricsCollector,
    type ProcessSnapshot,
} from "../../src/Metrics/MetricsCollector";

async function snapshotOf(source: string, build: (registry: Registry) => void): Promise<ProcessSnapshot> {
    const registry = new Registry();
    build(registry);
    return { source, metrics: await registry.getMetricsAsJSON() };
}

const guilds = (count: number) => (registry: Registry) => {
    new Gauge({ name: "discordmute_guilds", help: "g", registers: [registry] }).set(count);
};

function fakeInstance(replies: (cluster: { id: number }) => Promise<unknown>) {
    const clusters = new Map([
        [0, { id: 0 }],
        [1, { id: 1 }],
    ]);
    return {
        clusters,
        sendRequestToCluster: vi.fn((cluster: { id: number }) => replies(cluster)),
    };
}

const okReply = (id: number) => ({ ok: true, source: `cluster-${id}`, metrics: [] });

describe("MetricsCollector", () => {
    it("merges gateway and two cluster snapshots", async () => {
        const gatewayRegistry = new Registry();
        new Counter({ name: "discordmute_plugin_events_total", help: "e", registers: [gatewayRegistry] }).inc(2);
        const clusters: ClusterSnapshotSource = {
            snapshots: async () => [await snapshotOf("cluster-0", guilds(3)), await snapshotOf("cluster-1", guilds(4))],
        };
        const collector = new MetricsCollector({ gatewayRegistry, clusters });

        const snapshots = await collector.snapshots();
        expect(snapshots.map((s) => s.source)).toEqual(["gateway", "cluster-0", "cluster-1"]);

        const text = await (await collector.aggregated()).metrics();
        expect(text).toContain("discordmute_guilds 7");
        expect(text).toContain("discordmute_plugin_events_total 2");
    });

    it("GalacticSnapshotSource skips a cluster that times out and counts the failure", async () => {
        const instance = fakeInstance((cluster) =>
            cluster.id === 0
                ? Promise.resolve(okReply(0))
                : new Promise(() => {
                      /* never answers */
                  }),
        );
        const onFailure = vi.fn();
        const source = new GalacticSnapshotSource(instance as never, onFailure);

        const snapshots = await source.snapshots(50);

        expect(snapshots).toEqual([{ source: "cluster-0", metrics: [] }]);
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(instance.sendRequestToCluster).toHaveBeenCalledWith({ id: 0 }, { kind: "metrics-snapshot" }, 50);
    });

    it("skips an invalid snapshot reply", async () => {
        const instance = fakeInstance((cluster) => Promise.resolve(cluster.id === 0 ? okReply(0) : { nonsense: true }));
        const onFailure = vi.fn();

        const snapshots = await new GalacticSnapshotSource(instance as never, onFailure).snapshots(50);

        expect(snapshots.map((s) => s.source)).toEqual(["cluster-0"]);
        expect(onFailure).toHaveBeenCalledTimes(1);
    });
});
