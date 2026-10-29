import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createGatewayRequestHandler } from "../../src/Gateway/GatewayRequestHandler";
import { MAX_SESSIONS_PER_GUILD } from "../../src/Gateway/PluginGateway";
import { PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import {
    GUILD,
    gameEvent,
    hello,
    nextMessage,
    usePluginGatewayFixture,
    waitForClose,
} from "../Helpers/PluginGatewayFixture";

describe("PluginGateway", () => {
    const fx = usePluginGatewayFixture();

    describe("parallel sessions", () => {
        const keyOf = (n: number) => n.toString(16).padStart(32, "0");

        async function authenticateWithKey(connectionKey?: string): Promise<WebSocket> {
            const ws = await fx.connect();
            const welcome = nextMessage(ws);
            ws.send(hello(connectionKey ? { connectionKey } : {}));
            expect(await welcome).toEqual({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
            return ws;
        }

        it("two connection keys in one guild run in parallel", async () => {
            const first = await authenticateWithKey(keyOf(1));
            const second = await authenticateWithKey(keyOf(2));
            first.send(gameEvent("first"));
            second.send(gameEvent("second"));

            await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(2));
            const ids = new Set(fx.sentOfKind("game-event").map((e) => e.sessionId));
            expect(ids.size).toBe(2);
            expect(first.readyState).toBe(WebSocket.OPEN);
            expect(second.readyState).toBe(WebSocket.OPEN);
            expect(fx.gateway.sessionsOfGuild(GUILD)).toBe(2);
            expect(fx.gateway.sessionCount()).toBe(2);

            first.close();
            await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(1));
            expect(fx.gateway.isConnected(GUILD)).toBe(true);
            expect(fx.gateway.sessionsOfGuild(GUILD)).toBe(1);
        });

        it("same connection key replaces with 4004", async () => {
            const first = await authenticateWithKey(keyOf(1));
            const firstClosed = waitForClose(first);
            await authenticateWithKey(keyOf(1));

            expect((await firstClosed).code).toBe(4004);
            expect(fx.gateway.sessionsOfGuild(GUILD)).toBe(1);
            expect(fx.sentOfKind("session-ended")).toHaveLength(0);
        });

        it("missing connection key behaves like before", async () => {
            const keyed = await authenticateWithKey(keyOf(1));
            const first = await authenticateWithKey();
            const firstClosed = waitForClose(first);
            await authenticateWithKey();

            expect((await firstClosed).code).toBe(4004);
            expect(keyed.readyState).toBe(WebSocket.OPEN);
            expect(fx.gateway.sessionsOfGuild(GUILD)).toBe(2);
        });

        it("26th session in a guild is closed with 4006", async () => {
            for (let n = 1; n <= MAX_SESSIONS_PER_GUILD; n++) await authenticateWithKey(keyOf(n));
            expect(fx.gateway.sessionsOfGuild(GUILD)).toBe(25);

            const extra = await fx.connect();
            const closed = waitForClose(extra);
            extra.send(hello({ connectionKey: keyOf(26) }));

            expect(await closed).toEqual({ code: 4006, reason: "Too many games on this server" });
            expect(fx.gateway.sessionsOfGuild(GUILD)).toBe(25);

            const replacing = await authenticateWithKey(keyOf(25));
            expect(replacing.readyState).toBe(WebSocket.OPEN);
            expect(fx.gateway.sessionsOfGuild(GUILD)).toBe(25);
        });

        it("pushLinkPending reaches every session of the guild", async () => {
            const sockets = [await authenticateWithKey(keyOf(1)), await authenticateWithKey(keyOf(2))];
            const pending = sockets.map((ws) => nextMessage(ws));

            expect(fx.gateway.pushLinkPending(GUILD, "link-AAAA", "1-2", "user-1")).toBe(true);

            for (const message of await Promise.all(pending)) {
                expect(message).toEqual({
                    type: "link-pending",
                    phrase: "link-AAAA",
                    quickChatCode: "1-2",
                    discordId: "user-1",
                });
            }
        });

        it("disconnectGuild closes all sessions and routes session-ended for each", async () => {
            const sockets = [await authenticateWithKey(keyOf(1)), await authenticateWithKey(keyOf(2))];
            const closed = sockets.map((ws) => waitForClose(ws));

            expect(fx.gateway.disconnectGuild(GUILD, 4005, "Blocked")).toBe(2);

            for (const result of await Promise.all(closed)) expect(result).toEqual({ code: 4005, reason: "Blocked" });
            await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(2));
            expect(new Set(fx.sentOfKind("session-ended").map((e) => e.sessionId)).size).toBe(2);
            expect(fx.gateway.isConnected(GUILD)).toBe(false);
            expect(fx.gateway.disconnectGuild(GUILD, 4005, "Blocked")).toBe(0);
        });

        it("rotating the secret disconnects every session of the guild", async () => {
            const sockets = [await authenticateWithKey(keyOf(1)), await authenticateWithKey(keyOf(2))];
            const closed = sockets.map((ws) => waitForClose(ws));

            const reply = createGatewayRequestHandler(fx.gateway)({
                kind: "disconnect-guild",
                guildId: GUILD,
                code: 4001,
                reason: "Secret rotated",
            });

            expect(reply).toEqual({ ok: true });
            for (const result of await Promise.all(closed)) {
                expect(result).toEqual({ code: 4001, reason: "Secret rotated" });
            }
            await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(2));
        });
    });
});
