import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClusterRequestHandlerDeps, createClusterRequestHandler } from "../../src/Cluster/clusterRequestHandler";
import { logger } from "../../src/Logging/logger";

describe("createClusterRequestHandler", () => {
    const mute = {
        handleGameEvent: vi.fn(async () => ({ ok: true as const })),
        endSession: vi.fn(async () => {}),
    };
    let updateLinkReply: ReturnType<typeof vi.fn<ClusterRequestHandlerDeps["updateLinkReply"]>>;

    beforeEach(() => {
        vi.spyOn(logger, "warn").mockImplementation(() => {});
        updateLinkReply = vi.fn<ClusterRequestHandlerDeps["updateLinkReply"]>(async () => true);
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    function handler(isReady = () => true) {
        return createClusterRequestHandler({ mute, updateLinkReply, isReady });
    }

    it("refuses requests until the cluster finished starting", async () => {
        const reply = await handler(() => false)({ kind: "session-ended", guildId: "g", sessionId: "s" });
        expect(reply).toEqual({ ok: false, error: "cluster starting" });
        expect(mute.endSession).not.toHaveBeenCalled();
    });

    it("passes game events to the mute service", async () => {
        const req = {
            kind: "game-event",
            guildId: "g",
            sessionId: "s",
            hostAccountName: "Red",
            event: "game-start",
            players: ["Red"],
            deadPlayers: [],
        };
        expect(await handler()(req)).toEqual({ ok: true });
        expect(mute.handleGameEvent).toHaveBeenCalledWith(req);
    });

    it("ends the session on session-ended", async () => {
        expect(await handler()({ kind: "session-ended", guildId: "g", sessionId: "s" })).toEqual({ ok: true });
        expect(mute.endSession).toHaveBeenCalledWith("g", "s");
    });

    it("updates the link reply and reports when that fails", async () => {
        const req = { kind: "link-confirmed", guildId: "g", discordId: "d", accountName: "Red" };
        expect(await handler()(req)).toEqual({ ok: true });
        expect(updateLinkReply).toHaveBeenCalledWith({ guildId: "g", discordId: "d", accountName: "Red" });

        updateLinkReply.mockResolvedValueOnce(false);
        expect(await handler()(req)).toMatchObject({ ok: false });
    });

    it("rejects malformed requests", async () => {
        expect(await handler()({ kind: "game-event", guildId: "g" })).toEqual({ ok: false, error: "invalid request" });
        expect(await handler()("nonsense")).toEqual({ ok: false, error: "invalid request" });
        expect(mute.handleGameEvent).not.toHaveBeenCalled();
    });
});
