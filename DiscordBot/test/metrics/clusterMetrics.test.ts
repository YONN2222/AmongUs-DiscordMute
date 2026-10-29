import { buildGuildCreateDispatch } from "probe.ts";
import { type Histogram, Registry } from "prom-client";
import { afterEach, describe, expect, it } from "vitest";
import { createDiscordClient } from "../../src/Cluster/createDiscordClient";
import { createClusterMetrics, instrumentVoiceAdapter, registerDiscordMetrics } from "../../src/Metrics/clusterMetrics";
import type { VoiceAdapter, VoiceMember } from "../../src/Mute/MuteService";
import { DEFAULT_SETTINGS, type GuildSettings, mergeSettings } from "../../src/Settings/GuildSettings";
import { TELEMETRY_FEATURES } from "../../src/Telemetry/contract/schema";
import { createTestProbe } from "../helpers/probe";

const MEMBERS: VoiceMember[] = [{ discordId: "1", serverMuted: false, serverDeafened: false, isBot: false }];

function fakeAdapter(options: { delayMs?: number; fail?: boolean } = {}): VoiceAdapter & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        membersInChannel: async (guildId, channelId) => {
            calls.push(`members:${guildId}:${channelId}`);
            return MEMBERS;
        },
        findVoiceMember: async () => null,
        setVoiceState: async (guildId, discordId, patch) => {
            calls.push(`state:${guildId}:${discordId}:${JSON.stringify(patch)}`);
            await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
            if (options.fail) throw new Error("Missing Permissions");
        },
    };
}

async function metricValues(registry: Registry, name: string) {
    const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name);
    return metric?.values ?? [];
}

async function counterValue(registry: Registry, name: string, labels: Record<string, string> = {}) {
    const values = await metricValues(registry, name);
    const match = values.find((v) => Object.entries(labels).every(([k, l]) => v.labels[k] === l));
    return match?.value ?? 0;
}

async function histogram(registry: Registry) {
    const metric = registry.getSingleMetric("discordmute_mute_latency_seconds") as Histogram | undefined;
    const values = (await metric?.get())?.values ?? [];
    const pick = (metricName: string) => values.find((v) => v.metricName === metricName)?.value ?? 0;
    return {
        count: pick("discordmute_mute_latency_seconds_count"),
        sum: pick("discordmute_mute_latency_seconds_sum"),
    };
}

describe("instrumentVoiceAdapter", () => {
    it("counts a mute and records its latency", async () => {
        const registry = new Registry();
        const voice = instrumentVoiceAdapter(fakeAdapter({ delayMs: 20 }), createClusterMetrics(registry, 0));

        await voice.setVoiceState("g", "u", { mute: true });

        const latency = await histogram(registry);
        expect(latency.count).toBe(1);
        expect(latency.sum).toBeGreaterThanOrEqual(0.02);
        expect(await counterValue(registry, "discordmute_mutes_total", { action: "mute" })).toBe(1);
    });

    it("counts unmute separately", async () => {
        const registry = new Registry();
        const voice = instrumentVoiceAdapter(fakeAdapter(), createClusterMetrics(registry, 0));

        await voice.setVoiceState("g", "u", { mute: false });
        await voice.setVoiceState("g", "u", { mute: false, deaf: false });

        expect(await counterValue(registry, "discordmute_mutes_total", { action: "unmute" })).toBe(2);
        expect(await counterValue(registry, "discordmute_mutes_total", { action: "mute" })).toBe(0);
    });

    it("neither times nor counts a deafen-only change", async () => {
        const registry = new Registry();
        const inner = fakeAdapter();
        const voice = instrumentVoiceAdapter(inner, createClusterMetrics(registry, 0));

        await voice.setVoiceState("g", "u", { deaf: true });

        expect(inner.calls).toEqual(['state:g:u:{"deaf":true}']);
        expect((await histogram(registry)).count).toBe(0);
        expect(await counterValue(registry, "discordmute_mutes_total", { action: "mute" })).toBe(0);
        expect(await counterValue(registry, "discordmute_mutes_total", { action: "unmute" })).toBe(0);
    });

    it("counts a failure without a latency sample and rethrows", async () => {
        const registry = new Registry();
        const voice = instrumentVoiceAdapter(fakeAdapter({ fail: true }), createClusterMetrics(registry, 0));

        await expect(voice.setVoiceState("g", "u", { mute: true })).rejects.toThrow("Missing Permissions");

        expect((await histogram(registry)).count).toBe(0);
        expect(await counterValue(registry, "discordmute_mute_failures_total")).toBe(1);
        expect(await counterValue(registry, "discordmute_mutes_total", { action: "mute" })).toBe(0);
    });

    it("passes membersInChannel through untouched", async () => {
        const inner = fakeAdapter();
        const voice = instrumentVoiceAdapter(inner, createClusterMetrics(new Registry(), 0));

        expect(await voice.membersInChannel("g", "c")).toBe(MEMBERS);
        expect(await voice.findVoiceMember("g", "u")).toBeNull();
        expect(inner.calls).toEqual(["members:g:c"]);
    });
});

describe("feature_guilds gauge", () => {
    const GUILD_A = "111111111111111111";
    const GUILD_B = "222222222222222222";
    const saved: Record<string, GuildSettings> = {
        [GUILD_A]: mergeSettings(DEFAULT_SETTINGS, { ghostChat: true, autoRelink: false }),
    };

    async function featureValues(guildIds: string[]) {
        const registry = new Registry();
        createClusterMetrics(registry, 0).attachFeatureSource({
            guildIds: () => guildIds,
            settings: async (guildId) => saved[guildId] ?? DEFAULT_SETTINGS,
        });
        const values = await metricValues(registry, "discordmute_feature_guilds");
        return Object.fromEntries(values.map((v) => [v.labels.feature, v.value]));
    }

    it("counts enabled features per served guild and applies defaults to guilds without settings", async () => {
        const counts = await featureValues([GUILD_A, GUILD_B]);

        expect(counts).toMatchObject({ ghostChat: 1, autoRelink: 1, serverLog: 0, nicknameSync: 0 });
        expect(Object.keys(counts).sort()).toEqual([...TELEMETRY_FEATURES].sort());
    });

    it("does not count a guild the cluster no longer serves", async () => {
        const counts = await featureValues([GUILD_B]);

        expect(counts).toMatchObject({ ghostChat: 0, autoRelink: 1 });
    });

    it("feature gauge skips a guild whose settings read fails", async () => {
        const registry = new Registry();
        createClusterMetrics(registry, 0).attachFeatureSource({
            guildIds: () => [GUILD_A, GUILD_B, "333333333333333333"],
            settings: async (guildId) => {
                if (guildId === GUILD_B) throw new Error("database down");
                return saved[guildId] ?? DEFAULT_SETTINGS;
            },
        });

        const values = await metricValues(registry, "discordmute_feature_guilds");
        const counts = Object.fromEntries(values.map((v) => [v.labels.feature, v.value]));

        expect(counts).toMatchObject({ ghostChat: 1, autoRelink: 1 });
    });

    it("reports zero for every feature without guilds", async () => {
        const counts = await featureValues([]);

        expect(Object.values(counts).every((value) => value === 0)).toBe(true);
    });
});

describe("registerDiscordMetrics", () => {
    let probe: ReturnType<typeof createTestProbe> | undefined;

    afterEach(async () => {
        await probe?.teardown();
        probe = undefined;
    });

    it("a REST rateLimited event increments rate_limit_hits_total", async () => {
        const client = createDiscordClient();
        probe = createTestProbe(client);
        const registry = new Registry();
        registerDiscordMetrics(client, createClusterMetrics(registry, 0));
        await probe.setup();

        client.rest.emit("rateLimited", {
            global: false,
            hash: "hash",
            limit: 5,
            majorParameter: "1",
            method: "PATCH",
            retryAfter: 1000,
            route: "/guilds/:id/members/:id",
            scope: "user",
            sublimitTimeout: 0,
            timeToReset: 1000,
            url: "https://discord.com/api/v10/guilds/1/members/2",
        });

        expect(await counterValue(registry, "discordmute_rate_limit_hits_total")).toBe(1);
    });

    it("guilds gauge reports the cached guild count", async () => {
        const client = createDiscordClient();
        probe = createTestProbe(client);
        const registry = new Registry();
        registerDiscordMetrics(client, createClusterMetrics(registry, 3));
        await probe.setup();
        probe.injectDispatch(buildGuildCreateDispatch());

        expect(await counterValue(registry, "discordmute_guilds")).toBe(client.guilds.cache.size);
        expect(client.guilds.cache.size).toBeGreaterThan(0);
        expect(await counterValue(registry, "discordmute_cluster_guilds", { cluster: "3" })).toBe(
            client.guilds.cache.size,
        );
    });
});
