import { DiscordAPIError } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagePort } from "../../src/Cluster/messagePort";
import type { PendingLink } from "../../src/Data/repositories/PendingLinkRepository";
import type { TrackedMessage } from "../../src/Data/repositories/TrackedMessageRepository";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { LinkOverviewPublisher } from "../../src/LinkOverview/LinkOverviewPublisher";
import { logger } from "../../src/Logging/logger";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";

const GUILD = "1200000000000000001";
const CHANNEL = "1200000000000000010";
const NEW_CHANNEL = "1200000000000000011";
const USER = "1300000000000000001";

function apiError(code: number, status: number): DiscordAPIError {
    return new DiscordAPIError({ code, message: "failure" }, code, status, "PATCH", "/x", {} as never);
}

function settingsWith(channelId: string | null, showPending = false, language: "en" | "de" = "en"): GuildSettings {
    return { ...DEFAULT_SETTINGS, language, linkOverview: { channelId, showPending } };
}

const linkChanged = (): GuildEvent => ({ type: "link-changed", guildId: GUILD, discordId: USER, change: "linked" });

function setup(initial: GuildSettings = settingsWith(CHANNEL), tracked?: TrackedMessage[]) {
    const state = { settings: initial, links: 3, pending: [] as PendingLink[] };
    const rows = new Map<string, TrackedMessage>();
    for (const row of tracked ?? []) rows.set(`${row.guildId}:${row.kind}:${row.key}`, row);
    const port = {
        post: vi.fn<MessagePort["post"]>(async () => "m-new"),
        edit: vi.fn<MessagePort["edit"]>(async () => {}),
        delete: vi.fn<MessagePort["delete"]>(async () => {}),
    };
    const repo = {
        get: vi.fn(async (guildId: string, kind: string, key: string) => rows.get(`${guildId}:${kind}:${key}`) ?? null),
        upsert: vi.fn(async (m: TrackedMessage) => {
            rows.set(`${m.guildId}:${m.kind}:${m.key}`, m);
        }),
        remove: vi.fn(async (guildId: string, kind: string, key: string) => {
            rows.delete(`${guildId}:${kind}:${key}`);
        }),
        listByGuilds: vi.fn(async (guildIds: string[], kind: string) =>
            [...rows.values()].filter((m) => guildIds.includes(m.guildId) && m.kind === kind),
        ),
    };
    const publisher = new LinkOverviewPublisher({
        port,
        links: {
            countByGuild: async () => state.links,
            listPage: async (guildId, _offset, limit) =>
                Array.from({ length: Math.min(limit, state.links) }, (_, i) => ({
                    guildId,
                    discordId: `${USER}${i}`,
                    accountName: `Player${i}`,
                    linkedAt: "2026-01-01T00:00:00.000Z",
                    friendCode: null,
                })),
        },
        pending: {
            listActiveByGuild: async (_guildId, now, limit) =>
                state.pending.filter((p) => p.expiresAt > now).slice(0, limit),
            countActive: async (_guildId, now) => state.pending.filter((p) => p.expiresAt > now).length,
        },
        tracked: repo,
        settings: { get: async () => state.settings },
    });
    return { port, repo, rows, publisher, state };
}

describe("LinkOverviewPublisher", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("posts once for a burst of link changes and edits at most once after the interval", async () => {
        const { port, publisher, rows } = setup();

        for (let i = 0; i < 10; i++) publisher.handle(linkChanged());
        await vi.advanceTimersByTimeAsync(1000);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(port.post.mock.calls[0][0]).toBe(CHANNEL);
        expect(rows.get(`${GUILD}:link-overview:`)).toMatchObject({ channelId: CHANNEL, messageId: "m-new" });

        for (let i = 0; i < 10; i++) publisher.handle(linkChanged());
        await vi.advanceTimersByTimeAsync(3000);
        expect(port.edit).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(port.edit).toHaveBeenCalledWith(CHANNEL, "m-new", expect.anything());
        expect(port.post).toHaveBeenCalledTimes(1);
    });

    it("does nothing without a configured channel", async () => {
        const { port, publisher } = setup(settingsWith(null));

        publisher.handle(linkChanged());
        await vi.advanceTimersByTimeAsync(10_000);

        expect(port.post).not.toHaveBeenCalled();
        expect(port.edit).not.toHaveBeenCalled();
        expect(port.delete).not.toHaveBeenCalled();
    });

    it("reposts when the overview message was deleted", async () => {
        const old = {
            guildId: GUILD,
            kind: "link-overview",
            key: "",
            channelId: CHANNEL,
            messageId: "m-old",
            deleteAt: null,
        } as const;
        const { port, publisher, rows } = setup(settingsWith(CHANNEL), [old]);
        port.edit.mockRejectedValueOnce(apiError(10008, 404));

        publisher.handle(linkChanged());
        await vi.advanceTimersByTimeAsync(1000);

        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(rows.get(`${GUILD}:link-overview:`)).toMatchObject({ channelId: CHANNEL, messageId: "m-new" });
    });

    it("stops after missing access until the next event", async () => {
        const old = {
            guildId: GUILD,
            kind: "link-overview",
            key: "",
            channelId: CHANNEL,
            messageId: "m-old",
            deleteAt: null,
        } as const;
        const { port, publisher } = setup(settingsWith(CHANNEL), [old]);
        port.edit.mockRejectedValue(apiError(50001, 403));

        publisher.handle(linkChanged());
        await vi.advanceTimersByTimeAsync(1000);
        expect(port.edit).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(120_000);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(port.post).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);

        publisher.handle(linkChanged());
        await vi.advanceTimersByTimeAsync(10_000);
        expect(port.edit).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("moves the overview when the channel changes", async () => {
        const old = {
            guildId: GUILD,
            kind: "link-overview",
            key: "",
            channelId: CHANNEL,
            messageId: "m-old",
            deleteAt: null,
        } as const;
        const { port, publisher, state, rows } = setup(settingsWith(CHANNEL), [old]);
        const before = state.settings;
        state.settings = settingsWith(NEW_CHANNEL);

        publisher.handle({
            type: "settings-changed",
            guildId: GUILD,
            actorId: USER,
            paths: ["linkOverview.channelId"],
            before,
            after: state.settings,
        });
        await vi.advanceTimersByTimeAsync(1000);

        expect(port.delete).toHaveBeenCalledWith(CHANNEL, "m-old");
        expect(port.post).toHaveBeenCalledWith(NEW_CHANNEL, expect.anything());
        expect(port.edit).not.toHaveBeenCalled();
        expect(rows.get(`${GUILD}:link-overview:`)).toMatchObject({ channelId: NEW_CHANNEL, messageId: "m-new" });
    });

    it("deletes the message and the tracked row when the channel is cleared", async () => {
        const old = {
            guildId: GUILD,
            kind: "link-overview",
            key: "",
            channelId: CHANNEL,
            messageId: "m-old",
            deleteAt: null,
        } as const;
        const { port, publisher, state, rows } = setup(settingsWith(CHANNEL), [old]);
        const before = state.settings;
        state.settings = settingsWith(null);

        publisher.handle({
            type: "settings-changed",
            guildId: GUILD,
            actorId: USER,
            paths: ["linkOverview.channelId"],
            before,
            after: state.settings,
        });
        await vi.advanceTimersByTimeAsync(1000);

        expect(port.delete).toHaveBeenCalledWith(CHANNEL, "m-old");
        expect(port.post).not.toHaveBeenCalled();
        expect(rows.size).toBe(0);
    });

    it("ignores settings changes that do not touch the overview", async () => {
        const { port, publisher, state } = setup();

        publisher.handle({
            type: "settings-changed",
            guildId: GUILD,
            actorId: USER,
            paths: ["ghostChat"],
            before: state.settings,
            after: state.settings,
        });
        await vi.advanceTimersByTimeAsync(10_000);

        expect(port.post).not.toHaveBeenCalled();
    });

    it("reacts to pending changes only while pending links are shown", async () => {
        const hidden = setup(settingsWith(CHANNEL, false));
        hidden.publisher.handle({ type: "pending-changed", guildId: GUILD, discordId: USER });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(hidden.port.post).not.toHaveBeenCalled();

        const shown = setup(settingsWith(CHANNEL, true));
        shown.publisher.handle({ type: "pending-changed", guildId: GUILD, discordId: USER });
        await vi.advanceTimersByTimeAsync(1000);
        expect(shown.port.post).toHaveBeenCalledTimes(1);
    });

    it("refreshes once more when the earliest pending link expires", async () => {
        const { port, publisher, state } = setup(settingsWith(CHANNEL, true));
        state.pending = [
            {
                guildId: GUILD,
                discordId: USER,
                phrase: "link-AAAA",
                quickChatCode: "1-2",
                quickChatIds: [1, 2],
                expiresAt: Date.now() + 30_000,
            },
        ];

        publisher.handle({ type: "pending-changed", guildId: GUILD, discordId: USER });
        await vi.advanceTimersByTimeAsync(1000);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(port.post.mock.calls[0][1])).toContain(`<@${USER}>`);

        await vi.advanceTimersByTimeAsync(31_000);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(port.edit.mock.calls[0][2])).not.toContain(`Waiting for a link`);
    });

    it("resumes tracked overviews spaced 250 ms apart", async () => {
        const rowFor = (guildId: string) =>
            ({
                guildId,
                kind: "link-overview",
                key: "",
                channelId: CHANNEL,
                messageId: `m-${guildId}`,
                deleteAt: null,
            }) as const;
        const { port, publisher } = setup(settingsWith(CHANNEL), [rowFor("ga"), rowFor("gb"), rowFor("gc")]);

        const done = publisher.resume(["ga", "gb", "gc", "gd"]);
        await vi.advanceTimersByTimeAsync(0);
        expect(port.edit).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(250);
        expect(port.edit).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(250);
        expect(port.edit).toHaveBeenCalledTimes(3);
        await done;
        expect(port.edit.mock.calls.map((c) => c[1])).toEqual(["m-ga", "m-gb", "m-gc"]);
    });

    it("uses the guild language for the public message", async () => {
        const { port, publisher } = setup(settingsWith(CHANNEL, false, "de"));

        publisher.handle(linkChanged());
        await vi.advanceTimersByTimeAsync(1000);

        expect(JSON.stringify(port.post.mock.calls[0][1])).toContain("Verkn");
    });
});
