import { AggregatorRegistry, Counter, Gauge, Histogram, Registry } from "prom-client";
import { describe, expect, it } from "vitest";

async function aggregate(registries: Registry[]): Promise<string> {
    const jsons = await Promise.all(registries.map((registry) => registry.getMetricsAsJSON()));
    return AggregatorRegistry.aggregate(jsons).metrics();
}

describe("prom-client under Bun", () => {
    it("counter, gauge and histogram work under the Bun runtime", async () => {
        expect(typeof Bun).not.toBe("undefined");
        const registry = new Registry();
        const counter = new Counter({ name: "c_total", help: "c", registers: [registry] });
        const gauge = new Gauge({ name: "g", help: "g", registers: [registry] });
        const histogram = new Histogram({ name: "h_seconds", help: "h", buckets: [1, 2], registers: [registry] });
        counter.inc(2);
        gauge.set(7);
        histogram.observe(1.5);

        const json = await registry.getMetricsAsJSON();
        const byName = new Map(json.map((metric) => [metric.name, metric]));
        expect(byName.get("c_total")?.values[0]?.value).toBe(2);
        expect(byName.get("g")?.values[0]?.value).toBe(7);
        expect(await registry.metrics()).toContain("h_seconds_sum 1.5");
    });

    it("aggregate sums counters of two registries", async () => {
        const make = (value: number) => {
            const registry = new Registry();
            const counter = new Counter({
                name: "discordmute_plugin_events_total",
                help: "e",
                labelNames: ["type"],
                registers: [registry],
            });
            counter.inc({ type: "lobby" }, value);
            return registry;
        };
        const text = await aggregate([make(2), make(3)]);
        expect(text).toContain('discordmute_plugin_events_total{type="lobby"} 5');
    });

    it("aggregate keeps per-cluster labels apart", async () => {
        const make = (cluster: string) => {
            const registry = new Registry();
            const gauge = new Gauge({
                name: "discordmute_cluster_guilds",
                help: "g",
                labelNames: ["cluster"],
                registers: [registry],
            });
            gauge.set({ cluster }, 4);
            return registry;
        };
        const text = await aggregate([make("0"), make("1")]);
        expect(text).toContain('discordmute_cluster_guilds{cluster="0"} 4');
        expect(text).toContain('discordmute_cluster_guilds{cluster="1"} 4');
    });
});
