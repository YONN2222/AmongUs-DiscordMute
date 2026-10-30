import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagePort } from "../../src/Cluster/MessagePort";
import type { LinkEntry } from "../../src/Data/Repositories/LinkRepository";
import type { TrackedMessage } from "../../src/Data/Repositories/TrackedMessageRepository";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { StatusMessage } from "../../src/Game/StatusMessage";
import { logger } from "../../src/Logging/Logger";
import type { RosterEntry } from "../../src/Protocol/PluginProtocol";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";

const GUILD = "1200000000000000001";
const CHANNEL = "1200000000000000010";
const RED_ID = "1300000000000000001";
const BLUE_ID = "1300000000000000002";
const SESSION = "s1";

const settingsWith = (channelId: string | null): GuildSettings => ({
    ...DEFAULT_SETTINGS,
    status: { channelId, lobbyCode: "always" },
});

const roster = (...entries: Array<[string, boolean]>): RosterEntry[] =>
    entries.map(([name, dead]) => ({ name, dead, disconnected: false }));

function gameEvent(
    event: "lobby" | "game-start" | "meeting-start" | "meeting-end" | "player-died",
    entries: RosterEntry[],
    extra: Partial<Extract<GuildEvent, { type: "game-event" }>> = {},
): GuildEvent {
    return {
        type: "game-event",
        guildId: GUILD,
        sessionId: SESSION,
        event,
        hostAccountName: "Red",
        players: entries.filter((e) => !e.dead).map((e) => e.name),
        deadPlayers: entries.filter((e) => e.dead).map((e) => e.name),
        roster: entries,
        channelIds: [],
        ...extra,
    };
}

function setup(initial: GuildSettings = settingsWith(CHANNEL), tracked: TrackedMessage[] = []) {
    const linkOf = (discordId: string, accountName: string): LinkEntry => ({
        guildId: GUILD,
        discordId,
        accountName,
        linkedAt: "2026-01-01T00:00:00.000Z",
        friendCode: null,
    });
    const state = { settings: initial, links: [linkOf(RED_ID, "Red")] };
    const rows = new Map<string, TrackedMessage>();
    for (const row of tracked) rows.set(`${row.guildId}:${row.kind}:${row.key}`, row);
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
    const status = new StatusMessage({
        port,
        tracked: repo,
        links: { listByGuild: async () => state.links },
        settings: { get: async () => state.settings },
    });
    return { port, rows, status, state, linkOf };
}

const bodyOf = (call: unknown[]) => JSON.stringify(call[call.length - 1]);

describe("StatusMessage", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("posts on the lobby event and edits once on game-start", async () => {
        const { port, status, rows } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false], ["Blue", false]), { lobbyCode: "ABCDEF" }));
        await vi.advanceTimersByTimeAsync(10);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(port.post.mock.calls[0][0]).toBe(CHANNEL);
        expect(bodyOf(port.post.mock.calls[0])).toContain("ABCDEF");
        expect(bodyOf(port.post.mock.calls[0])).toContain(`<@${RED_ID}>`);
        expect(rows.get(`${GUILD}:status:${SESSION}`)).toMatchObject({ channelId: CHANNEL, messageId: "m-new" });

        await status.handle(gameEvent("game-start", roster(["Red", false], ["Blue", false])));
        await vi.advanceTimersByTimeAsync(5000);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(port.edit).toHaveBeenCalledWith(CHANNEL, "m-new", expect.anything());
    });

    it("debounces a burst of events into one edit", async () => {
        const { port, status } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(10);
        for (let i = 0; i < 5; i++) await status.handle(gameEvent("lobby", roster(["Red", false], [`P${i}`, false])));
        await vi.advanceTimersByTimeAsync(5000);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(bodyOf(port.edit.mock.calls[0])).toContain("P4");
    });

    it("status does not reveal a death before the next meeting", async () => {
        const { port, status } = setup();
        await status.handle(gameEvent("game-start", roster(["Red", false], ["Blue", false])));
        await vi.advanceTimersByTimeAsync(10);
        await status.handle(gameEvent("player-died", roster(["Red", true], ["Blue", false])));
        await vi.advanceTimersByTimeAsync(10_000);
        const outputs = [...port.post.mock.calls, ...port.edit.mock.calls].map(bodyOf);
        expect(outputs.some((body) => body.includes("(dead)"))).toBe(false);
        expect(port.edit).not.toHaveBeenCalled();

        await status.handle(gameEvent("meeting-start", roster(["Red", true], ["Blue", false])));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(bodyOf(port.edit.mock.calls[0])).toContain("(dead)");
    });

    it("falls back to deadPlayers for a v2 plugin without a roster", async () => {
        const { port, status } = setup();
        await status.handle(
            gameEvent("meeting-start", [], { roster: undefined, players: ["Blue"], deadPlayers: ["Red"] }),
        );
        await vi.advanceTimersByTimeAsync(10);
        expect(bodyOf(port.post.mock.calls[0])).toContain("(dead)");
        expect(bodyOf(port.post.mock.calls[0])).toContain("Blue");
    });

    it("deletes the message and the row when the session ends", async () => {
        const { port, status, rows } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(10);
        await status.handle({ type: "session-ended", guildId: GUILD, sessionId: SESSION });
        expect(port.delete).toHaveBeenCalledWith(CHANNEL, "m-new");
        expect(rows.size).toBe(0);
    });

    it("keeps the row when the delete fails transiently and drops it for a gone message", async () => {
        const { DiscordAPIError } = await import("discord.js");
        const { port, status, rows } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(10);

        port.delete.mockRejectedValueOnce(new Error("offline"));
        await status.handle({ type: "session-ended", guildId: GUILD, sessionId: SESSION });
        expect(rows.size).toBe(1);

        port.delete.mockRejectedValueOnce(
            new DiscordAPIError({ code: 10008, message: "Unknown Message" }, 10008, 404, "DELETE", "/x", {} as never),
        );
        await status.recover([GUILD]);
        expect(rows.size).toBe(0);
    });

    it("never posts after the session ended", async () => {
        const { port, status } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await status.handle({ type: "session-ended", guildId: GUILD, sessionId: SESSION });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(port.post).not.toHaveBeenCalled();
    });

    it("makes no port calls without a status channel", async () => {
        const { port, status, rows } = setup(settingsWith(null));
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(10_000);
        await status.handle({ type: "session-ended", guildId: GUILD, sessionId: SESSION });
        expect(port.post).not.toHaveBeenCalled();
        expect(port.edit).not.toHaveBeenCalled();
        expect(port.delete).not.toHaveBeenCalled();
        expect(rows.size).toBe(0);
    });

    it("posts a new message when the old one was deleted", async () => {
        const { port, status } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(10);
        const { DiscordAPIError } = await import("discord.js");
        port.edit.mockRejectedValueOnce(
            new DiscordAPIError({ code: 10008, message: "Unknown Message" }, 10008, 404, "PATCH", "/x", {} as never),
        );
        await status.handle(gameEvent("game-start", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(5000);
        expect(port.post).toHaveBeenCalledTimes(2);
    });

    it("status messages of parallel sessions do not replace each other", async () => {
        const { port, status, rows } = setup();
        port.post.mockResolvedValueOnce("m-1").mockResolvedValueOnce("m-2");
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(10);
        await status.handle(gameEvent("lobby", roster(["Blue", false]), { sessionId: "s2" }));
        await vi.advanceTimersByTimeAsync(10);

        expect(port.post).toHaveBeenCalledTimes(2);
        expect(port.delete).not.toHaveBeenCalled();
        expect(rows.get(`${GUILD}:status:${SESSION}`)).toMatchObject({ messageId: "m-1" });
        expect(rows.get(`${GUILD}:status:s2`)).toMatchObject({ messageId: "m-2" });

        await status.handle({ type: "session-ended", guildId: GUILD, sessionId: SESSION });
        expect(port.delete).toHaveBeenCalledTimes(1);
        expect(port.delete).toHaveBeenCalledWith(CHANNEL, "m-1");
    });

    it("shows a player as linked once they link while the lobby is open", async () => {
        const { port, status, state, linkOf } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false], ["Blue", false])));
        await vi.advanceTimersByTimeAsync(10);
        expect(bodyOf(port.post.mock.calls[0])).not.toContain(`<@${BLUE_ID}>`);

        state.links = [...state.links, linkOf(BLUE_ID, "Blue")];
        await status.handle({
            type: "link-changed",
            guildId: GUILD,
            discordId: BLUE_ID,
            change: "linked",
            accountName: "Blue",
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(bodyOf(port.edit.mock.calls[0])).toContain(`<@${BLUE_ID}>`);
    });

    it("ignores link changes of a guild without a running session", async () => {
        const { port, status } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false])));
        await vi.advanceTimersByTimeAsync(10);
        await status.handle({
            type: "link-changed",
            guildId: "1200000000000000099",
            discordId: BLUE_ID,
            change: "linked",
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(port.edit).not.toHaveBeenCalled();
        expect(port.post).toHaveBeenCalledTimes(1);
    });

    it("redraws with the new lobby code mode when the status settings change", async () => {
        const { port, status, state } = setup();
        await status.handle(gameEvent("lobby", roster(["Red", false]), { lobbyCode: "ABCDEF" }));
        await vi.advanceTimersByTimeAsync(10);
        expect(bodyOf(port.post.mock.calls[0])).not.toContain("||ABCDEF||");

        const before = state.settings;
        state.settings = { ...before, status: { ...before.status, lobbyCode: "spoiler" } };
        await status.handle({
            type: "settings-changed",
            guildId: GUILD,
            actorId: RED_ID,
            paths: ["status.lobbyCode"],
            before,
            after: state.settings,
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(port.edit).toHaveBeenCalledTimes(1);
        expect(bodyOf(port.edit.mock.calls[0])).toContain("||ABCDEF||");
    });

    it("hides the lobby code behind a spoiler by default", async () => {
        const { port, status } = setup({
            ...DEFAULT_SETTINGS,
            status: { ...DEFAULT_SETTINGS.status, channelId: CHANNEL },
        });
        await status.handle(gameEvent("lobby", roster(["Red", false]), { lobbyCode: "ABCDEF" }));
        await vi.advanceTimersByTimeAsync(10);
        expect(bodyOf(port.post.mock.calls[0])).toContain("||ABCDEF||");
    });

    it("recover deletes the message of a leftover row", async () => {
        const leftover: TrackedMessage = {
            guildId: GUILD,
            kind: "status",
            key: "old",
            channelId: CHANNEL,
            messageId: "m-old",
            deleteAt: null,
        };
        const { port, status, rows } = setup(settingsWith(CHANNEL), [leftover]);
        await status.recover([GUILD]);
        expect(port.delete).toHaveBeenCalledWith(CHANNEL, "m-old");
        expect(rows.size).toBe(0);
    });
});
