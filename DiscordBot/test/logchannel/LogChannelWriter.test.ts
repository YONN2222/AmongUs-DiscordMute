import { DiscordAPIError } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagePayload, MessagePort } from "../../src/Cluster/messagePort";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { t } from "../../src/i18n";
import { LogChannelWriter } from "../../src/LogChannel/LogChannelWriter";
import { logger } from "../../src/Logging/logger";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";

const GUILD = "1200000000000000001";
const CHANNEL = "1400000000000000001";
const USER = "130000000000000000";

function textOf(payload: MessagePayload): string {
    return JSON.stringify(payload.components);
}

function contentOf(payload: MessagePayload): string {
    const [container] = payload.components as { components: { content: string }[] }[];
    return container.components[0].content;
}

function unlinked(index = 0): GuildEvent {
    return { type: "link-changed", guildId: GUILD, discordId: `${USER}${index}`, change: "unlinked" };
}

function makeWriter(settings: GuildSettings = { ...DEFAULT_SETTINGS, logChannelId: CHANNEL }) {
    const port = {
        post: vi.fn<MessagePort["post"]>(async () => "m1"),
        edit: vi.fn<MessagePort["edit"]>(async () => {}),
        delete: vi.fn<MessagePort["delete"]>(async () => {}),
    };
    const writer = new LogChannelWriter({ port, settings: { get: async () => settings } });
    return { port, writer };
}

describe("LogChannelWriter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("bundles events of one flush window into a single post", async () => {
        const { port, writer } = makeWriter();

        await writer.handle(unlinked(1));
        await writer.handle(unlinked(2));
        await writer.handle(unlinked(3));
        expect(port.post).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);

        expect(port.post).toHaveBeenCalledTimes(1);
        const [channelId, payload] = port.post.mock.calls[0];
        expect(channelId).toBe(CHANNEL);
        expect(textOf(payload)).toContain(`${USER}1`);
        expect(textOf(payload)).toContain(`${USER}3`);
    });

    it("caps the queue at 50 lines and reports how many were left out", async () => {
        const { port, writer } = makeWriter();

        for (let i = 0; i < 60; i++) await writer.handle(unlinked(i));
        await vi.advanceTimersByTimeAsync(2000);

        expect(port.post).toHaveBeenCalledTimes(1);
        expect(contentOf(port.post.mock.calls[0][1]).endsWith(t("en", "log.more", { count: 10 }))).toBe(true);
    });

    it("keeps the rest of an oversized flush for the next one", async () => {
        const { port, writer } = makeWriter();
        const longName = "n".repeat(100);
        const linked = (index: number): GuildEvent => ({
            type: "link-changed",
            guildId: GUILD,
            discordId: `${USER}${index}`,
            change: "linked",
            accountName: `${longName}${index}`,
        });

        for (let i = 0; i < 50; i++) await writer.handle(linked(i));
        await vi.advanceTimersByTimeAsync(2000);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(contentOf(port.post.mock.calls[0][1]).length).toBeLessThanOrEqual(3800);

        await vi.advanceTimersByTimeAsync(2000);
        expect(port.post).toHaveBeenCalledTimes(2);
        expect(contentOf(port.post.mock.calls[1][1])).toContain(`${longName}49`);
    });

    it("reports a lost log channel once and stops posting", async () => {
        const { port, writer } = makeWriter();
        port.post.mockRejectedValue(
            new DiscordAPIError({ code: 50001, message: "Missing Access" }, 50001, 403, "POST", "/x", {} as never),
        );

        await writer.handle(unlinked(1));
        await vi.advanceTimersByTimeAsync(2000);
        for (let i = 2; i < 7; i++) await writer.handle(unlinked(i));
        await vi.advanceTimersByTimeAsync(4000);
        await writer.flushAll();

        expect(port.post).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("posts nothing without a log channel", async () => {
        const { port, writer } = makeWriter({ ...DEFAULT_SETTINGS, logChannelId: null });

        await writer.handle(unlinked());
        await vi.advanceTimersByTimeAsync(5000);
        await writer.flushAll();

        expect(port.post).not.toHaveBeenCalled();
    });

    it("logs a voice error code once per ten minutes", async () => {
        const { port, writer } = makeWriter();
        const voiceError = (index: number): GuildEvent => ({
            type: "voice-error",
            guildId: GUILD,
            code: "member-not-editable",
            discordId: `${USER}${index}`,
        });

        await writer.handle(voiceError(1));
        await writer.handle(voiceError(2));
        await vi.advanceTimersByTimeAsync(2000);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(textOf(port.post.mock.calls[0][1])).toContain(`${USER}1`);
        expect(textOf(port.post.mock.calls[0][1])).not.toContain(`${USER}2`);

        await vi.advanceTimersByTimeAsync(10 * 60_000);
        await writer.handle(voiceError(3));
        await vi.advanceTimersByTimeAsync(2000);
        expect(port.post).toHaveBeenCalledTimes(2);
    });

    it("announces a session once and starts one implicitly from a game event", async () => {
        const { port, writer } = makeWriter();
        const started = (sessionId: string): GuildEvent => ({
            type: "session-started",
            guildId: GUILD,
            sessionId,
            pluginVersion: "3.0.1",
            gameVersion: "2026.9.29",
            protocolVersion: 3,
        });

        await writer.handle(started("s1"));
        await writer.handle(started("s1"));
        await vi.advanceTimersByTimeAsync(2000);
        expect(contentOf(port.post.mock.calls[0][1]).match(/3.0.1/g)).toHaveLength(1);

        await writer.handle({
            type: "game-event",
            guildId: GUILD,
            sessionId: "s2",
            event: "lobby",
            hostAccountName: "Red",
            players: [],
            deadPlayers: [],
            channelIds: [],
        });
        await vi.advanceTimersByTimeAsync(2000);
        expect(port.post).toHaveBeenCalledTimes(2);
        expect(contentOf(port.post.mock.calls[1][1])).toBe(t("en", "log.sessionStartedImplicit"));
    });

    it("flushes pending lines on flushAll", async () => {
        const { port, writer } = makeWriter();

        await writer.handle(unlinked());
        await writer.flushAll();

        expect(port.post).toHaveBeenCalledTimes(1);
    });
});
