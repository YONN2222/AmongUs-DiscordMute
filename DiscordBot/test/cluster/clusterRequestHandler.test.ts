import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClusterRequestHandlerDeps, createClusterRequestHandler } from "../../src/Cluster/clusterRequestHandler";
import { type GuildEvent, GuildEventBus } from "../../src/Events/GuildEvents";
import { logger } from "../../src/Logging/logger";
import type { RouterReply } from "../../src/Routing/messages";

describe("createClusterRequestHandler", () => {
    const mute = {
        handleGameEvent: vi.fn(async (): Promise<RouterReply & { channelIds?: string[] }> => ({ ok: true })),
        endSession: vi.fn(async () => {}),
    };
    let updateLinkReply: ReturnType<typeof vi.fn<ClusterRequestHandlerDeps["updateLinkReply"]>>;
    let events: { emit: ReturnType<typeof vi.fn<(e: GuildEvent) => void>> };

    beforeEach(() => {
        vi.spyOn(logger, "warn").mockImplementation(() => {});
        vi.spyOn(logger, "error").mockImplementation(() => {});
        updateLinkReply = vi.fn<ClusterRequestHandlerDeps["updateLinkReply"]>(async () => true);
        events = { emit: vi.fn<(e: GuildEvent) => void>() };
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    function handler(isReady = () => true, overrides: Partial<ClusterRequestHandlerDeps> = {}) {
        return createClusterRequestHandler({ mute, updateLinkReply, isReady, events, ...overrides });
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

    it("keeps the reply when a bus handler throws", async () => {
        const bus = new GuildEventBus();
        bus.on(() => {
            throw new Error("handler boom");
        });

        expect(await handler(undefined, { events: bus })(gameEvent)).toEqual({ ok: true });
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    });

    it("rejects malformed requests", async () => {
        expect(await handler()({ kind: "game-event", guildId: "g" })).toEqual({ ok: false, error: "invalid request" });
        expect(await handler()("nonsense")).toEqual({ ok: false, error: "invalid request" });
        expect(mute.handleGameEvent).not.toHaveBeenCalled();
    });
});
