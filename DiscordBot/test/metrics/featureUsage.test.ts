import { describe, expect, it } from "vitest";
import { countFeatureGuilds } from "../../src/Metrics/featureUsage";
import { DEFAULT_SETTINGS, mergeSettings, type SettingsPatch } from "../../src/Settings/GuildSettings";
import { TELEMETRY_FEATURES } from "../../src/Telemetry/contract/schema";

const CHANNEL = "123456789012345678";
const count = (patch: SettingsPatch) => countFeatureGuilds([mergeSettings(DEFAULT_SETTINGS, patch)]);

describe("countFeatureGuilds", () => {
    it("counts only autoRelink for a server on the defaults", () => {
        const counts = countFeatureGuilds([DEFAULT_SETTINGS]);

        expect(Object.keys(counts).sort()).toEqual([...TELEMETRY_FEATURES].sort());
        expect(Object.entries(counts).filter(([, n]) => n > 0)).toEqual([["autoRelink", 1]]);
    });

    it.each([
        ["linkOverview", { linkOverview: { channelId: CHANNEL } }],
        ["serverLog", { logChannelId: CHANNEL }],
        ["voiceRules", { voiceRules: { meeting: { dead: "deafen" } } }],
        ["phaseDelays", { delaysMs: { lobby: 500 } }],
        ["ghostChat", { ghostChat: true }],
        ["liveStatus", { status: { channelId: CHANNEL } }],
        ["spectatorHandling", { nonPlayers: "as-dead" }],
        ["nicknameSync", { nicknameSync: true }],
        ["matchSummary", { summary: { channelId: CHANNEL } }],
    ] as const)("counts %s when it is switched on", (feature, patch) => {
        expect(count(patch as SettingsPatch)[feature]).toBe(1);
    });

    it("does not count autoRelink when it was turned off", () => {
        expect(count({ autoRelink: false }).autoRelink).toBe(0);
    });

    it("sums over several servers", () => {
        const counts = countFeatureGuilds([
            mergeSettings(DEFAULT_SETTINGS, { ghostChat: true }),
            mergeSettings(DEFAULT_SETTINGS, { ghostChat: true, nicknameSync: true }),
            DEFAULT_SETTINGS,
        ]);

        expect(counts).toMatchObject({ ghostChat: 2, nicknameSync: 1, autoRelink: 3 });
    });
});
