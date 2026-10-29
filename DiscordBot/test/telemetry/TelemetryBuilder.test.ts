import { Counter, Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { createClusterMetrics } from "../../src/Metrics/clusterMetrics";
import { createGatewayMetrics } from "../../src/Metrics/gatewayMetrics";
import { sanitizeVersionLabel } from "../../src/Metrics/labels";
import type { ProcessSnapshot } from "../../src/Metrics/MetricsCollector";
import { MAX_BODY_BYTES } from "../../src/Telemetry/contract/contract";
import { telemetryPacketSchema } from "../../src/Telemetry/contract/schema";
import { TelemetryBuilder } from "../../src/Telemetry/TelemetryBuilder";

const INSTANCE_ID = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8d0b7a41";
const GUILD_ID = "111111111111111111";
const USER_ID = "222222222222222222";

type GatewayFixture = {
    events?: Partial<Record<string, number>>;
    gamesMuted?: number;
    plugins?: number;
    active?: number;
    sessions?: { plugin: string; game: string; count: number }[];
};

async function gatewaySnapshot(fixture: GatewayFixture): Promise<ProcessSnapshot> {
    const registry = new Registry();
    const metrics = createGatewayMetrics(registry);
    for (const [type, count] of Object.entries(fixture.events ?? {})) metrics.pluginEvents.inc({ type }, count);
    if (fixture.gamesMuted) metrics.gamesMuted.inc(fixture.gamesMuted);
    metrics.pluginsConnected.set(fixture.plugins ?? 0);
    metrics.activeGames.set(fixture.active ?? 0);
    for (const session of fixture.sessions ?? []) {
        metrics.pluginSessions.set(
            {
                plugin_version: sanitizeVersionLabel(session.plugin),
                game_version: sanitizeVersionLabel(session.game),
            },
            session.count,
        );
    }
    return { source: "gateway", metrics: (await registry.getMetricsAsJSON()) as ProcessSnapshot["metrics"] };
}

type ClusterFixture = {
    mutes?: number;
    unmutes?: number;
    guilds?: number;
    rateLimits?: number;
    latencies?: number[];
    features?: Record<string, number>;
};

async function clusterSnapshot(id: number, fixture: ClusterFixture): Promise<ProcessSnapshot> {
    const registry = new Registry();
    const metrics = createClusterMetrics(registry, id);
    if (fixture.mutes) metrics.mutes.inc({ action: "mute" }, fixture.mutes);
    if (fixture.unmutes) metrics.mutes.inc({ action: "unmute" }, fixture.unmutes);
    if (fixture.rateLimits) metrics.rateLimitHits.inc(fixture.rateLimits);
    for (const latency of fixture.latencies ?? []) metrics.muteLatency.observe(latency);
    for (const [feature, count] of Object.entries(fixture.features ?? {}))
        metrics.featureGuilds.set({ feature }, count);
    metrics.attachClient({ guilds: { cache: { size: fixture.guilds ?? 0 } }, ws: { ping: -1 } });
    return { source: `cluster-${id}`, metrics: (await registry.getMetricsAsJSON()) as ProcessSnapshot["metrics"] };
}

function builder(overrides: Partial<ConstructorParameters<typeof TelemetryBuilder>[0]> = {}): TelemetryBuilder {
    return new TelemetryBuilder({
        instanceId: INSTANCE_ID,
        mode: "self-host",
        botVersion: "3.0.0",
        countLinkedUsers: async () => 9,
        ...overrides,
    });
}

const fixtureSnapshots = async (): Promise<ProcessSnapshot[]> => [
    await gatewaySnapshot({
        events: { lobby: 2, "game-start": 1, "meeting-start": 3, "link-chat": 5 },
        gamesMuted: 1,
        plugins: 3,
        active: 1,
        sessions: [
            { plugin: "2.1.0", game: "2026.9.29", count: 2 },
            { plugin: "Red Crewmate", game: "2026.9.29", count: 1 },
        ],
    }),
    await clusterSnapshot(0, {
        mutes: 4,
        unmutes: 3,
        guilds: 5,
        rateLimits: 1,
        latencies: Array(7).fill(0.25),
        features: { voiceRules: 1 },
    }),
    await clusterSnapshot(1, { mutes: 1, guilds: 2, latencies: [0.5], features: { voiceRules: 1 } }),
];

describe("TelemetryBuilder", () => {
    it("builds a packet that the website schema accepts", async () => {
        const packet = await builder().build(await fixtureSnapshots());

        expect(telemetryPacketSchema.safeParse(packet).success).toBe(true);
        expect(JSON.stringify(packet).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
        const { packetId, ...rest } = packet;
        expect(packetId).toMatch(/^[0-9a-f-]{36}$/);
        expect(rest).toEqual({
            schemaVersion: 1,
            instanceId: INSTANCE_ID,
            mode: "self-host",
            versions: { bot: "3.0.0", plugins: { "2.1.0": 2, "0": 1 }, amongUs: { "2026.9.29": 3 } },
            gauges: { uniqueUsers: 9, activeGames: 1, guilds: 7, connectedPlugins: 3 },
            deltas: {
                gamesMuted: 1,
                mutes: 5,
                unmutes: 3,
                rateLimitHits: 1,
                events: { lobby: 2, "game-start": 1, "meeting-start": 3 },
            },
            latency: { avgMs: 281.3, samples: 8 },
            features: { voiceRules: 2 },
        });
    });

    it("two builds get different packetIds", async () => {
        const instance = builder();
        const snapshots = await fixtureSnapshots();
        expect((await instance.build(snapshots)).packetId).not.toBe((await instance.build(snapshots)).packetId);
    });

    it("second build sends only the delta", async () => {
        const instance = builder();
        await instance.build([await gatewaySnapshot({ events: { lobby: 2 } }), await clusterSnapshot(0, { mutes: 4 })]);

        const second = await instance.build([
            await gatewaySnapshot({ events: { lobby: 5 } }),
            await clusterSnapshot(0, { mutes: 4, unmutes: 1 }),
        ]);

        expect(second.deltas).toMatchObject({ mutes: 0, unmutes: 1, events: { lobby: 3 } });
    });

    it("cluster restart between builds gives no negative and no double count", async () => {
        const instance = builder();
        await instance.build([
            await gatewaySnapshot({ events: { lobby: 4 } }),
            await clusterSnapshot(0, { mutes: 10 }),
        ]);

        const packet = await instance.build([
            await gatewaySnapshot({ events: { lobby: 6 } }),
            await clusterSnapshot(0, { mutes: 3 }),
        ]);

        expect(packet.deltas.mutes).toBe(3);
        expect(packet.deltas.events).toEqual({ lobby: 2 });
    });

    it("a cluster missing in one build does not lose or repeat its counts", async () => {
        const instance = builder();
        await instance.build([await clusterSnapshot(0, { mutes: 4 }), await clusterSnapshot(1, { mutes: 2 })]);
        const without = await instance.build([await clusterSnapshot(0, { mutes: 5 })]);
        const back = await instance.build([
            await clusterSnapshot(0, { mutes: 5 }),
            await clusterSnapshot(1, { mutes: 3 }),
        ]);

        expect(without.deltas.mutes).toBe(1);
        expect(back.deltas.mutes).toBe(1);
    });

    it("latency is avgMs 0 and samples 0 without mutes", async () => {
        const packet = await builder().build([await clusterSnapshot(0, { guilds: 1 })]);
        expect(packet.latency).toEqual({ avgMs: 0, samples: 0 });
    });

    it("latency is avgMs 0 and samples 0 when timed calls exist but no mutes were counted", async () => {
        const packet = await builder().build([await clusterSnapshot(0, { latencies: [0.4, 0.6] })]);
        expect(packet.latency).toEqual({ avgMs: 0, samples: 0 });
    });

    it("latency samples are capped at mutes plus unmutes", async () => {
        const packet = await builder().build([await clusterSnapshot(0, { mutes: 1, latencies: [0.1, 0.1, 0.1] })]);
        expect(packet.latency.samples).toBe(1);
    });

    it("activeGames above connectedPlugins is clamped", async () => {
        const packet = await builder().build([await gatewaySnapshot({ plugins: 1, active: 4 })]);
        expect(packet.gauges).toMatchObject({ activeGames: 1, connectedPlugins: 1 });
    });

    it("feature counts above guilds are capped", async () => {
        const packet = await builder().build([
            await clusterSnapshot(0, { guilds: 3, features: { ghostChat: 50, voiceRules: 1 } }),
        ]);
        expect(packet.features).toEqual({ ghostChat: 3, voiceRules: 1 });
    });

    it("feature counts are summed over clusters and zero counts are left out", async () => {
        const packet = await builder().build([
            await clusterSnapshot(0, { guilds: 4, features: { ghostChat: 2, serverLog: 0, autoRelink: 4 } }),
            await clusterSnapshot(1, { guilds: 3, features: { ghostChat: 1, matchSummary: 3 } }),
        ]);
        expect(packet.features).toEqual({ ghostChat: 3, autoRelink: 4, matchSummary: 3 });
    });

    it("keys outside the contract are never emitted", async () => {
        const packet = await builder().build([
            await clusterSnapshot(0, { guilds: 3, features: { language: 3, "123456789012345678": 2, voiceRules: 1 } }),
        ]);
        expect(packet.features).toEqual({ voiceRules: 1 });
        expect(telemetryPacketSchema.safeParse(packet).success).toBe(true);
    });

    it("sends no features without a feature gauge", async () => {
        const packet = await builder().build([await clusterSnapshot(0, { guilds: 3 })]);
        expect(packet.features).toEqual({});
    });

    it("packet contains no ids or names", async () => {
        const registry = new Registry();
        const strayCounter = new Counter({
            name: "stray_total",
            help: "stray",
            labelNames: ["guild", "user"],
            registers: [registry],
        });
        strayCounter.inc({ guild: GUILD_ID, user: USER_ID }, 3);
        const stray: ProcessSnapshot = {
            source: `guild-${GUILD_ID}`,
            metrics: (await registry.getMetricsAsJSON()) as ProcessSnapshot["metrics"],
        };
        const leaky = await gatewaySnapshot({
            plugins: 2,
            sessions: [
                { plugin: GUILD_ID, game: USER_ID, count: 1 },
                { plugin: "Red Crewmate", game: "Red Crewmate", count: 1 },
            ],
        });
        const json = JSON.stringify(await builder().build([...(await fixtureSnapshots()), leaky, stray]));
        for (const forbidden of [GUILD_ID, USER_ID, "Red Crewmate", "Red", "Crewmate"]) {
            expect(json).not.toContain(forbidden);
        }
    });

    it("normalises odd version labels onto the website pattern", async () => {
        const packet = await builder({ botVersion: "3.0.0+abc" }).build([
            await gatewaySnapshot({
                plugins: 4,
                sessions: [
                    { plugin: "2.1.0-beta.2", game: "v2026.9.29", count: 1 },
                    { plugin: "2.1.0+build5", game: "other", count: 1 },
                    { plugin: "1.2.3.4.5", game: "garbage", count: 2 },
                ],
            }),
        ]);
        expect(telemetryPacketSchema.safeParse(packet).success).toBe(true);
        expect(packet.versions.bot).toBe("3.0.0");
        expect(packet.versions.plugins).toEqual({ "2.1.0-beta.2": 1, "2.1.0": 1, "1.2.3.4": 2 });
        expect(packet.versions.amongUs).toEqual({ "2026.9.29": 1, "0": 3 });
    });

    it("link-chat events are not in the packet", async () => {
        const packet = await builder().build([await gatewaySnapshot({ events: { "link-chat": 9 } })]);
        expect(packet.deltas.events).toEqual({});
        expect(JSON.stringify(packet)).not.toContain("link-chat");
    });

    it("resetBaseline makes the next build start from zero deltas", async () => {
        const instance = builder();
        const snapshots = await fixtureSnapshots();
        instance.resetBaseline(snapshots);

        const packet = await instance.build(snapshots);

        expect(packet.deltas).toEqual({ gamesMuted: 0, mutes: 0, unmutes: 0, rateLimitHits: 0, events: {} });
        expect(packet.latency).toEqual({ avgMs: 0, samples: 0 });
    });

    it("throws and keeps the baseline when the packet is invalid", async () => {
        const instance = builder({ instanceId: "not-a-uuid" });
        await expect(instance.build(await fixtureSnapshots())).rejects.toThrow();
    });
});
