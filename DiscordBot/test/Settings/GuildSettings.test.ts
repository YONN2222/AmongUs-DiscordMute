import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, diffSettings, mergeSettings, parseSettings } from "../../src/Settings/GuildSettings";

describe("parseSettings", () => {
    it("turns an empty object into the defaults", () => {
        expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    });

    it("turns non-objects into the defaults", () => {
        expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS);
    });

    it("uses the documented defaults", () => {
        expect(DEFAULT_SETTINGS).toEqual({
            language: "en",
            logChannelId: null,
            linkOverview: { channelId: null, showPending: false },
            voiceRules: {
                tasks: { alive: "mute", dead: "mute" },
                meeting: { alive: "free", dead: "mute" },
            },
            delaysMs: { gameStart: 0, meetingStart: 0, meetingEnd: 0, lobby: 0 },
            ghostChat: false,
            nonPlayers: "ignore",
            autoRelink: true,
            nicknameSync: false,
            status: { channelId: null, lobbyCode: "spoiler" },
            summary: { channelId: null, deleteAfterMinutes: 0 },
        });
    });

    it("clamps delays to 0..5000 whole milliseconds", () => {
        expect(parseSettings({ delaysMs: { gameStart: 99999 } }).delaysMs.gameStart).toBe(5000);
        expect(parseSettings({ delaysMs: { lobby: -4 } }).delaysMs.lobby).toBe(0);
        expect(parseSettings({ delaysMs: { meetingEnd: 12.6 } }).delaysMs.meetingEnd).toBe(13);
        expect(parseSettings({ delaysMs: { meetingStart: "fast" } }).delaysMs.meetingStart).toBe(0);
    });

    it("clamps deleteAfterMinutes to 0..1440", () => {
        expect(parseSettings({ summary: { deleteAfterMinutes: 5000 } }).summary.deleteAfterMinutes).toBe(1440);
        expect(parseSettings({ summary: { deleteAfterMinutes: 30 } }).summary.deleteAfterMinutes).toBe(30);
    });

    it("replaces invalid fields with their default and keeps valid siblings", () => {
        const parsed = parseSettings({ language: "fr", ghostChat: "yes", nicknameSync: true });
        expect(parsed.language).toBe("en");
        expect(parsed.ghostChat).toBe(false);
        expect(parsed.nicknameSync).toBe(true);
    });

    it("keeps valid siblings inside a section with an invalid field", () => {
        const parsed = parseSettings({ voiceRules: { tasks: { alive: "bogus", dead: "deafen" } } });
        expect(parsed.voiceRules.tasks).toEqual({ alive: "mute", dead: "deafen" });
    });

    it("replaces a section of the wrong type with its defaults", () => {
        expect(parseSettings({ voiceRules: 5, status: [] }).voiceRules).toEqual(DEFAULT_SETTINGS.voiceRules);
    });

    it("accepts only snowflakes as channel ids", () => {
        expect(parseSettings({ logChannelId: "abc" }).logChannelId).toBeNull();
        expect(parseSettings({ logChannelId: "123456789012345678" }).logChannelId).toBe("123456789012345678");
        expect(parseSettings({ status: { channelId: 42 } }).status.channelId).toBeNull();
    });

    it("drops unknown keys", () => {
        expect(parseSettings({ bogus: 1 })).toEqual(DEFAULT_SETTINGS);
    });
});

describe("mergeSettings", () => {
    it("changes only the patched leaf and leaves the base untouched", () => {
        const snapshot = structuredClone(DEFAULT_SETTINGS);
        const merged = mergeSettings(DEFAULT_SETTINGS, { voiceRules: { meeting: { dead: "deafen" } } });

        expect(merged.voiceRules.meeting).toEqual({ alive: "free", dead: "deafen" });
        expect(merged.voiceRules.tasks).toEqual(DEFAULT_SETTINGS.voiceRules.tasks);
        expect({ ...merged, voiceRules: DEFAULT_SETTINGS.voiceRules }).toEqual(DEFAULT_SETTINGS);
        expect(DEFAULT_SETTINGS).toEqual(snapshot);
    });

    it("sets a channel back to null", () => {
        const withChannel = mergeSettings(DEFAULT_SETTINGS, { logChannelId: "123456789012345678" });
        expect(mergeSettings(withChannel, { logChannelId: null }).logChannelId).toBeNull();
    });

    it("re-parses the result so invalid patch values fall back", () => {
        expect(mergeSettings(DEFAULT_SETTINGS, { delaysMs: { gameStart: 1e9 } }).delaysMs.gameStart).toBe(5000);
    });
});

describe("diffSettings", () => {
    it("lists the dot paths of changed leaves", () => {
        const after = mergeSettings(DEFAULT_SETTINGS, {
            voiceRules: { meeting: { dead: "deafen" } },
            ghostChat: true,
        });
        expect(diffSettings(DEFAULT_SETTINGS, after).sort()).toEqual(["ghostChat", "voiceRules.meeting.dead"]);
    });

    it("is empty when nothing changed", () => {
        expect(diffSettings(DEFAULT_SETTINGS, parseSettings({}))).toEqual([]);
    });
});
