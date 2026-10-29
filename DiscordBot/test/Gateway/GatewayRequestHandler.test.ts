import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayRequestHandler } from "../../src/Gateway/GatewayRequestHandler";
import { logger } from "../../src/Logging/Logger";

describe("createGatewayRequestHandler", () => {
    const plugins = {
        pushLinkPending: vi.fn(() => true),
        isConnected: vi.fn(() => true),
    };

    beforeEach(() => {
        vi.spyOn(logger, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it("pushes a pending link to the plugin of the guild", () => {
        const handle = createGatewayRequestHandler(plugins);
        const req = {
            kind: "push-link-pending",
            guildId: "g",
            phrase: "link-AAAA",
            quickChatCode: "1-2",
            discordId: "d",
        };

        expect(handle(req)).toEqual({ ok: true });
        expect(plugins.pushLinkPending).toHaveBeenCalledWith("g", "link-AAAA", "1-2", "d");

        plugins.pushLinkPending.mockReturnValueOnce(false);
        expect(handle(req)).toEqual({ ok: false, error: "plugin not connected" });
    });

    it("answers whether the plugin of a guild is connected", () => {
        const handle = createGatewayRequestHandler(plugins);
        expect(handle({ kind: "is-plugin-connected", guildId: "g" })).toEqual({ ok: true });

        plugins.isConnected.mockReturnValueOnce(false);
        expect(handle({ kind: "is-plugin-connected", guildId: "g" })).toEqual({
            ok: false,
            error: "plugin not connected",
        });
        expect(plugins.isConnected).toHaveBeenCalledWith("g");
    });

    it("rejects malformed requests", () => {
        const handle = createGatewayRequestHandler(plugins);
        expect(handle({ kind: "push-link-pending", guildId: "g" })).toEqual({ ok: false, error: "invalid request" });
        expect(handle(null)).toEqual({ ok: false, error: "invalid request" });
        expect(plugins.pushLinkPending).not.toHaveBeenCalled();
    });
});
