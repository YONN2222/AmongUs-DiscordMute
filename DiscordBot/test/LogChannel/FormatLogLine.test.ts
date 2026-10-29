import { describe, expect, it } from "vitest";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { formatLogLine } from "../../src/LogChannel/FormatLogLine";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";

const GUILD = "1200000000000000001";
const USER = "1300000000000000001";
const ACTOR = "1300000000000000002";
const CHANNEL = "1400000000000000001";
const names = () => "";

function line(event: GuildEvent, locale: "en" | "de" = "en"): string | null {
    return formatLogLine(event, locale, names);
}

describe("formatLogLine", () => {
    it("names both users and escapes the Among Us name of a force link", () => {
        const text = line({
            type: "link-changed",
            guildId: GUILD,
            discordId: USER,
            change: "force-linked",
            accountName: "**x**",
            actorId: ACTOR,
        });

        expect(text).toContain(`<@${USER}>`);
        expect(text).toContain(`<@${ACTOR}>`);
        expect(text).toContain("\\*\\*x\\*\\*");
    });

    it("keeps a typed mention in an Among Us name literal", () => {
        const text = line({
            type: "link-changed",
            guildId: GUILD,
            discordId: USER,
            change: "linked",
            accountName: "<@123456789012345678>",
        });

        expect(text).toContain("\\<@123456789012345678>");
        expect(text).not.toContain(" <@123456789012345678>");
    });

    it("does not log events that are not part of the log", () => {
        expect(line({ type: "pending-changed", guildId: GUILD, discordId: USER })).toBeNull();
        const gameEvent = (event: Extract<GuildEvent, { type: "game-event" }>["event"]): GuildEvent => ({
            type: "game-event",
            guildId: GUILD,
            sessionId: "s1",
            event,
            hostAccountName: "Red",
            players: ["Red"],
            deadPlayers: [],
            channelIds: [CHANNEL],
        });
        expect(line(gameEvent("player-died"))).toBeNull();
        expect(line(gameEvent("meeting-start"))).toBeNull();
        expect(line(gameEvent("game-start"))).toContain(`<#${CHANNEL}>`);
    });

    it("lists deaths only in the game end line", () => {
        const text = line({
            type: "game-ended",
            guildId: GUILD,
            sessionId: "s1",
            reason: "ImpostorsByKill",
            winners: ["Blue"],
            roster: [
                { name: "Red", dead: true, disconnected: false },
                { name: "Blue", dead: false, disconnected: false },
            ],
        });

        const [result, died] = (text ?? "").split("Died");
        expect(text).toContain("ImpostorsByKill");
        expect(died).toContain("Red");
        expect(died).not.toContain("Blue");
        expect(result).toContain("Blue");
    });

    it("describes plugin sessions", () => {
        const started = line({
            type: "session-started",
            guildId: GUILD,
            sessionId: "s1",
            pluginVersion: "3.0.1",
            gameVersion: "2026.9.29",
            protocolVersion: 3,
        });
        expect(started).toContain("3.0.1");
        expect(started).toContain("2026.9.29");
        expect(line({ type: "session-ended", guildId: GUILD, sessionId: "s1" })).toContain("disconnected");
    });

    it("lists every changed setting with channel values as channel mentions", () => {
        const after = {
            ...DEFAULT_SETTINGS,
            ghostChat: true,
            status: { ...DEFAULT_SETTINGS.status, channelId: CHANNEL },
        };
        const text = line({
            type: "settings-changed",
            guildId: GUILD,
            actorId: ACTOR,
            paths: ["ghostChat", "status.channelId"],
            before: DEFAULT_SETTINGS,
            after,
        });

        expect(text).toContain(`<@${ACTOR}>`);
        expect(text).toContain("ghostChat: false -> true");
        expect(text).toContain(`status.channelId: none -> <#${CHANNEL}>`);
    });

    it("secret change line names the actor and never pings", () => {
        const created = line({ type: "secret-changed", guildId: GUILD, actorId: ACTOR, created: true });
        const regenerated = line({ type: "secret-changed", guildId: GUILD, actorId: ACTOR, created: false });

        expect(created).toBe(`<@${ACTOR}> created a new plugin secret`);
        expect(regenerated).toBe(`<@${ACTOR}> generated a new plugin secret, running games were disconnected`);
        expect(line({ type: "secret-changed", guildId: GUILD, actorId: ACTOR, created: true }, "de")).not.toBe(created);
    });

    it("lists voice fallback channels as channel mentions", () => {
        const text = line({
            type: "settings-changed",
            guildId: GUILD,
            actorId: ACTOR,
            paths: ["voiceChannelIds"],
            before: DEFAULT_SETTINGS,
            after: { ...DEFAULT_SETTINGS, voiceChannelIds: ["1400000000000000001", "1400000000000000002"] },
        });

        expect(text).toContain("voiceChannelIds: none -> <#1400000000000000001>, <#1400000000000000002>");
    });

    it("hints at the missing permission and the role order for voice errors", () => {
        const permission = line({ type: "voice-error", guildId: GUILD, code: "missing-permission" });
        expect(permission).toContain("Mute Members");
        expect(permission).toContain("Deafen Members");
        expect(permission).toContain("Manage Nicknames");
        const editable = line({
            type: "voice-error",
            guildId: GUILD,
            code: "member-not-editable",
            discordId: USER,
        });
        expect(editable).toContain("role order");
        expect(editable).toContain(`<@${USER}>`);
    });

    it("escapes names resolved through the names callback", () => {
        const text = formatLogLine(
            { type: "voice-error", guildId: GUILD, code: "member-not-editable", discordId: USER },
            "en",
            () => "**x**",
        );
        expect(text).toContain("\\*\\*x\\*\\*");
        expect(text).not.toContain("**x**");
    });

    it("writes german lines that differ from the english ones", () => {
        const event: GuildEvent = { type: "session-ended", guildId: GUILD, sessionId: "s1" };
        expect(line(event, "de")).not.toBe(line(event, "en"));
    });

    it("uses no symbol characters", () => {
        const text = line({
            type: "settings-changed",
            guildId: GUILD,
            actorId: ACTOR,
            paths: ["autoRelink"],
            before: DEFAULT_SETTINGS,
            after: { ...DEFAULT_SETTINGS, autoRelink: false },
        });
        expect(text).toMatch(/^[\x20-\x7e\n]*$/);
    });
});
