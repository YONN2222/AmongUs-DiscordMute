import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClusterRequestHandlerDeps, createClusterRequestHandler } from "../../src/Cluster/ClusterRequestHandler";
import type { Database } from "../../src/Data/Database";
import type { LinkRepository } from "../../src/Data/Repositories/LinkRepository";
import { type GuildEvent, GuildEventBus } from "../../src/Events/GuildEvents";
import { logger } from "../../src/Logging/Logger";
import type { RouterReply } from "../../src/Routing/Messages";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { createTestDatabase } from "../Helpers/TestDatabase";

describe("createClusterRequestHandler", () => {
    const mute = {
        handleGameEvent: vi.fn(
            async (_req: { players: string[] }): Promise<RouterReply & { channelIds?: string[] }> => ({ ok: true }),
        ),
        endSession: vi.fn(async () => {}),
        hasEnded: vi.fn((_sessionId: string) => false),
    };
    let updateLinkReply: ReturnType<typeof vi.fn<ClusterRequestHandlerDeps["updateLinkReply"]>>;
    let events: { emit: ReturnType<typeof vi.fn<(e: GuildEvent) => void>> };
    let db: Database;
    let links: LinkRepository;

    beforeEach(async () => {
        db = await createTestDatabase();
        links = db.links;
        vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "error").mockImplementation(() => {});
        updateLinkReply = vi.fn<ClusterRequestHandlerDeps["updateLinkReply"]>(async () => true);
        events = { emit: vi.fn<(e: GuildEvent) => void>() };
    });

    afterEach(async () => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        await db.close();
    });

    function handler(isReady = () => true, overrides: Partial<ClusterRequestHandlerDeps> = {}) {
        return createClusterRequestHandler({
            mute,
            updateLinkReply,
            isReady,
            events,
            links,
            settings: { get: async () => DEFAULT_SETTINGS },
            ...overrides,
        });
    }

    const gameEvent = {
        kind: "game-event",
        guildId: "g",
        sessionId: "s",
        hostAccountName: "Red",
        event: "game-start",
        players: ["Red"],
        deadPlayers: [],
    };

    it("refuses requests until the cluster finished starting", async () => {
        const reply = await handler(() => false)({ kind: "session-ended", guildId: "g", sessionId: "s" });
        expect(reply).toEqual({ ok: false, error: "cluster starting" });
        expect(mute.endSession).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();
    });

    it("passes game events to the mute service", async () => {
        expect(await handler()(gameEvent)).toEqual({ ok: true });
        expect(mute.handleGameEvent).toHaveBeenCalledWith(gameEvent);
    });

    it("drops a game event of a session that already ended without emitting it", async () => {
        mute.hasEnded.mockReturnValueOnce(true);

        expect(await handler()(gameEvent)).toEqual({ ok: true });

        expect(mute.hasEnded).toHaveBeenCalledWith("s");
        expect(mute.handleGameEvent).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();
    });

    it("emits the game event with the channels the mute service used", async () => {
        mute.handleGameEvent.mockResolvedValueOnce({ ok: true, channelIds: ["c1", "c2"] });
        const roster = [{ name: "Red", dead: false, disconnected: false }];

        expect(await handler()({ ...gameEvent, roster, lobbyCode: "ABCD" })).toEqual({ ok: true });

        expect(events.emit).toHaveBeenCalledTimes(1);
        expect(events.emit).toHaveBeenCalledWith({
            type: "game-event",
            guildId: "g",
            sessionId: "s",
            event: "game-start",
            hostAccountName: "Red",
            players: ["Red"],
            deadPlayers: [],
            roster,
            lobbyCode: "ABCD",
            channelIds: ["c1", "c2"],
        });
    });

    it("emits no channels when the mute service answered with a notice", async () => {
        const notice = { code: "host-not-in-voice" as const, message: "m" };
        mute.handleGameEvent.mockResolvedValueOnce({ ok: true, notice, channelIds: ["c1"] });

        expect(await handler()(gameEvent)).toEqual({ ok: true, notice });
        expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "game-event", channelIds: [] }));
    });

    it("emits session-started and game-ended and answers ok", async () => {
        const started = {
            kind: "session-started",
            guildId: "g",
            sessionId: "s",
            pluginVersion: "3.0.1",
            gameVersion: "2026.9.29",
            protocolVersion: 3,
        };
        expect(await handler()(started)).toEqual({ ok: true });
        expect(events.emit).toHaveBeenLastCalledWith({
            type: "session-started",
            guildId: "g",
            sessionId: "s",
            pluginVersion: "3.0.1",
            gameVersion: "2026.9.29",
            protocolVersion: 3,
        });

        const roster = [{ name: "Red", friendCode: "red#1", dead: true, disconnected: false }];
        const ended = { kind: "game-ended", guildId: "g", sessionId: "s", reason: "HumansByVote", winners: [], roster };
        expect(await handler()(ended)).toEqual({ ok: true });
        expect(events.emit).toHaveBeenLastCalledWith({
            type: "game-ended",
            guildId: "g",
            sessionId: "s",
            reason: "HumansByVote",
            winners: [],
            roster,
        });
    });

    it("ends the session on session-ended and emits afterwards", async () => {
        mute.endSession.mockImplementationOnce(async () => {
            expect(events.emit).not.toHaveBeenCalled();
        });
        expect(await handler()({ kind: "session-ended", guildId: "g", sessionId: "s" })).toEqual({ ok: true });
        expect(mute.endSession).toHaveBeenCalledWith("g", "s");
        expect(events.emit).toHaveBeenCalledWith({ type: "session-ended", guildId: "g", sessionId: "s" });
    });

    it("answers session-ended only after the nicknames are restored, once", async () => {
        const order: string[] = [];
        const nicknames = {
            restoreSession: vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                order.push("restored");
            }),
        };
        events.emit.mockImplementation(() => {
            order.push("emitted");
        });

        const reply = await handler(undefined, { nicknames })({ kind: "session-ended", guildId: "g", sessionId: "s" });
        order.push("answered");

        expect(reply).toEqual({ ok: true });
        expect(nicknames.restoreSession).toHaveBeenCalledTimes(1);
        expect(nicknames.restoreSession).toHaveBeenCalledWith("g", "s");
        expect(order).toEqual(["restored", "emitted", "answered"]);
    });

    it("still answers session-ended when restoring nicknames fails", async () => {
        const nicknames = { restoreSession: vi.fn(async () => Promise.reject(new Error("rest down"))) };

        expect(
            await handler(undefined, { nicknames })({ kind: "session-ended", guildId: "g", sessionId: "s" }),
        ).toEqual({
            ok: true,
        });
        expect(events.emit).toHaveBeenCalledWith({ type: "session-ended", guildId: "g", sessionId: "s" });
        expect(logger.error).toHaveBeenCalled();
    });

    it("updates the link reply and reports when that fails", async () => {
        const req = { kind: "link-confirmed", guildId: "g", discordId: "d", accountName: "Red" };
        expect(await handler()(req)).toEqual({ ok: true });
        expect(updateLinkReply).toHaveBeenCalledWith({ guildId: "g", discordId: "d", accountName: "Red" });

        updateLinkReply.mockResolvedValueOnce(false);
        expect(await handler()(req)).toMatchObject({ ok: false });
    });

    it("emits link-changed and runs onLinkConfirmed for a confirmed link", async () => {
        const onLinkConfirmed = vi.fn(async () => {
            throw new Error("friend code store down");
        });
        const req = { kind: "link-confirmed", guildId: "g", discordId: "d", accountName: "Red", friendCode: "red#1" };

        expect(await handler(undefined, { onLinkConfirmed })(req)).toEqual({ ok: true });

        expect(onLinkConfirmed).toHaveBeenCalledWith({
            guildId: "g",
            discordId: "d",
            accountName: "Red",
            friendCode: "red#1",
        });
        expect(events.emit).toHaveBeenCalledWith({
            type: "link-changed",
            guildId: "g",
            discordId: "d",
            change: "linked",
            accountName: "Red",
        });
        expect(logger.error).toHaveBeenCalled();
    });

    describe("auto-relink", () => {
        const crimson = { name: "Crimson", friendCode: "abc#1", dead: false, disconnected: false };
        const gameStart = { ...gameEvent, players: ["Crimson"], roster: [crimson] };

        beforeEach(async () => {
            await links.upsert("g", "u1", "Red");
            await links.setFriendCode("g", "u1", "abc#1");
        });

        it("renames the link before the mute update so the same event mutes the member", async () => {
            const mutedIds: string[] = [];
            mute.handleGameEvent.mockImplementationOnce(async (req: { players: string[] }) => {
                for (const name of req.players) {
                    mutedIds.push(...(await links.findByAccountName("g", name)).map((l) => l.discordId));
                }
                return { ok: true };
            });

            expect(await handler()(gameStart)).toEqual({ ok: true });

            expect(mutedIds).toEqual(["u1"]);
            expect(events.emit).toHaveBeenCalledWith(
                expect.objectContaining({ type: "link-changed", change: "relinked", previousName: "Red" }),
            );
        });

        it("writes nothing when autoRelink is off", async () => {
            const writes = vi.spyOn(links, "rename");
            const stores = vi.spyOn(links, "setFriendCode");

            await handler(undefined, { settings: { get: async () => ({ ...DEFAULT_SETTINGS, autoRelink: false }) } })(
                gameStart,
            );

            expect(writes).not.toHaveBeenCalled();
            expect(stores).not.toHaveBeenCalled();
            expect((await links.get("g", "u1"))?.accountName).toBe("Red");
            expect(mute.handleGameEvent).toHaveBeenCalled();
        });

        it("still mutes when relinking fails", async () => {
            vi.spyOn(links, "listByGuild").mockRejectedValueOnce(new Error("db down"));

            expect(await handler()(gameStart)).toEqual({ ok: true });

            expect(mute.handleGameEvent).toHaveBeenCalledWith(gameStart);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    it("keeps the reply when a bus handler throws", async () => {
        const bus = new GuildEventBus();
        bus.on(() => {
            throw new Error("handler boom");
        });

        expect(await handler(undefined, { events: bus })(gameEvent)).toEqual({ ok: true });
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    });

    describe("leave-guild", () => {
        const leaveRequest = { kind: "leave-guild", guildId: "g", reason: "admin" };

        it("leave-guild request is refused when not hosted", async () => {
            expect(await handler()(leaveRequest)).toEqual({ ok: false, error: "not hosted" });
        });

        it("replies ok when the bot left the guild", async () => {
            const lifecycle = { leave: vi.fn(async () => true) };

            expect(await handler(undefined, { lifecycle })(leaveRequest)).toEqual({ ok: true });
            expect(lifecycle.leave).toHaveBeenCalledWith("g");
        });

        it("replies not-in-guild when the bot was not in the guild", async () => {
            const lifecycle = { leave: vi.fn(async () => false) };

            expect(await handler(undefined, { lifecycle })(leaveRequest)).toEqual({ ok: false, error: "not-in-guild" });
        });

        it("rejects an unknown reason", async () => {
            const lifecycle = { leave: vi.fn(async () => true) };

            expect(await handler(undefined, { lifecycle })({ ...leaveRequest, reason: "whim" })).toEqual({
                ok: false,
                error: "invalid request",
            });
            expect(lifecycle.leave).not.toHaveBeenCalled();
        });
    });

    it("rejects malformed requests", async () => {
        expect(await handler()({ kind: "game-event", guildId: "g" })).toEqual({ ok: false, error: "invalid request" });
        expect(await handler()("nonsense")).toEqual({ ok: false, error: "invalid request" });
        expect(mute.handleGameEvent).not.toHaveBeenCalled();
    });
});
