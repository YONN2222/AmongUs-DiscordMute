import type { AddressInfo } from "node:net";
import { Counter, Registry } from "prom-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/Logging/Logger";
import type { MetricsCollector } from "../../src/Metrics/MetricsCollector";
import { createMetricsServer } from "../../src/Metrics/MetricsServer";

const TOKEN = "0123456789abcdef";

function summedRegistry(): Registry {
    const registry = new Registry();
    new Counter({ name: "discordmute_mutes_total", help: "m", registers: [registry] }).inc(5);
    return registry;
}

const servers: ReturnType<typeof createMetricsServer>[] = [];

async function start(collector: Pick<MetricsCollector, "aggregated">, token?: string): Promise<string> {
    const server = createMetricsServer({ collector: collector as MetricsCollector, token });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise<void>((resolve) => {
                    server.closeAllConnections();
                    server.close(() => resolve());
                }),
        ),
    );
});

describe("metricsServer", () => {
    it("serves prometheus text with the summed counter", async () => {
        const url = await start({ aggregated: async () => summedRegistry() });
        const response = await fetch(`${url}/metrics`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/plain");
        expect(await response.text()).toContain("discordmute_mutes_total 5");
    });

    it("accepts the bearer token when one is set", async () => {
        const url = await start({ aggregated: async () => summedRegistry() }, TOKEN);
        const response = await fetch(`${url}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        expect(response.status).toBe(200);
    });

    it("401 without the bearer token when a token is set", async () => {
        const url = await start({ aggregated: async () => summedRegistry() }, TOKEN);
        const response = await fetch(`${url}/metrics`);
        expect(response.status).toBe(401);
        expect(await response.text()).toBe("");
    });

    it("401 with a wrong token of the same length", async () => {
        const url = await start({ aggregated: async () => summedRegistry() }, TOKEN);
        const response = await fetch(`${url}/metrics`, {
            headers: { Authorization: `Bearer ${"f".repeat(TOKEN.length)}` },
        });
        expect(response.status).toBe(401);
    });

    it("404 on /", async () => {
        const url = await start({ aggregated: async () => summedRegistry() });
        expect((await fetch(`${url}/`)).status).toBe(404);
    });

    it("500 when the collector throws", async () => {
        const logged = vi.spyOn(logger, "error").mockImplementation(() => undefined);
        const url = await start({
            aggregated: async () => {
                throw new Error("boom");
            },
        });
        const response = await fetch(`${url}/metrics`);
        expect(response.status).toBe(500);
        expect(logged).toHaveBeenCalledTimes(1);
        logged.mockRestore();
    });
});
