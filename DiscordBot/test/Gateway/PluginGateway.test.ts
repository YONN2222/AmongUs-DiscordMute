import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { LINK_CHAT_LIMIT_PER_MINUTE, PluginGateway } from "../../src/Gateway/PluginGateway";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { logger } from "../../src/Logging/Logger";
import { MIN_PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import type { RouterReply } from "../../src/Routing/Messages";
import {
    GUILD,
    gameEvent,
    hello,
    nextMessage,
    SECRET,
    sleep,
    usePluginGatewayFixture,
    waitForClose,
} from "../Helpers/PluginGatewayFixture";

describe("PluginGateway", () => {
    const fx = usePluginGatewayFixture();

    it("closes 4000 without hello", async () => {
        const ws = await fx.connect();
        expect((await waitForClose(ws)).code).toBe(4000);
    });

    it("closes 4001 on wrong secret", async () => {
        const ws = await fx.connect();
        const closed = waitForClose(ws);
        ws.send(hello({ secret: "wrong" }));
        expect((await closed).code).toBe(4001);
        expect(fx.gateway.isConnected(GUILD)).toBe(false);
    });

    it("closes 4002 on old protocol", async () => {
        const ws = await fx.connect();
        const closed = waitForClose(ws);
        ws.send(hello({ protocolVersion: MIN_PROTOCOL_VERSION - 1 }));
        expect(await closed).toEqual({ code: 4002, reason: "Plugin outdated, please update DiscordMute" });
    });

    it("closes 4003 on an invalid message after hello", async () => {
        const ws = await fx.authenticate();
        const closed = waitForClose(ws);
        ws.send("{not json");
        expect((await closed).code).toBe(4003);
    });

    it("tells a 2.x plugin, which sends the secret in the URL query, to update", async () => {
        fx.url = `${fx.url}?secret=${SECRET}`;
        const ws = await fx.connect();
        expect(await waitForClose(ws)).toEqual({ code: 4002, reason: "Plugin outdated, please update DiscordMute" });
        expect(logger.warn).toHaveBeenCalledWith(
            expect.anything(),
            "DiscordMute plugin 2.x connected, please update the plugin",
        );
        expect(fx.gateway.isConnected(GUILD)).toBe(false);
    });

    it("welcome after valid hello", async () => {
        await fx.authenticate();
        expect(fx.gateway.isConnected(GUILD)).toBe(true);
        expect(fx.gateway.sessionCount()).toBe(1);
    });

    it("routes game-event to the guild with the session id", async () => {
        const ws = await fx.authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));

        const [event] = fx.sentOfKind("game-event");
        expect(fx.router.sent[0]?.guildId).toBe(GUILD);
        expect(event).toEqual({
            kind: "game-event",
            guildId: GUILD,
            sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
            hostAccountName: "Host",
            event: "game-start",
            players: ["Host", "Crew"],
            deadPlayers: [],
        });
    });

    it("accepts a protocol 2 plugin and tells the cluster which protocol it speaks", async () => {
        const ws = await fx.connect();
        const welcome = nextMessage(ws);
        ws.send(hello({ protocolVersion: 2, pluginVersion: "3.0.0" }));
        expect(await welcome).toEqual({ type: "welcome", protocolVersion: 3 });
        expect(fx.gateway.isConnected(GUILD)).toBe(true);

        await vi.waitFor(() => expect(fx.sentOfKind("session-started")).toHaveLength(1));
        expect(fx.sentOfKind("session-started")[0]).toEqual({
            kind: "session-started",
            guildId: GUILD,
            sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
            pluginVersion: "3.0.0",
            gameVersion: "2026.9.1",
            protocolVersion: 2,
        });
    });

    it("stays active when session-started is not answered", async () => {
        await fx.restart({ routeTimeoutMs: 50 });
        fx.router.register(GUILD, (req) =>
            req.kind === "session-started" ? new Promise<RouterReply>(() => {}) : Promise.resolve({ ok: true }),
        );
        const ws = await fx.authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));
        await vi.waitFor(() =>
            expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("session-started")),
        );
        expect(fx.gateway.isConnected(GUILD)).toBe(true);
    });

    it("forwards roster and lobby code of a v3 game-event", async () => {
        const ws = await fx.authenticate();
        const roster = [{ name: "Host", friendCode: "host#1", dead: false, disconnected: false }];
        ws.send(JSON.stringify({ ...JSON.parse(gameEvent()), roster, lobbyCode: "ABCDEF" }));
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));
        expect(fx.sentOfKind("game-event")[0]).toMatchObject({ roster, lobbyCode: "ABCDEF" });
    });

    it("routes game-end as game-ended in the same session as the game events", async () => {
        const ws = await fx.authenticate();
        const roster = [{ name: "Crew", dead: true, disconnected: false }];
        ws.send(gameEvent());
        ws.send(JSON.stringify({ type: "game-end", reason: "ImpostorByKill", winners: ["Host"], roster }));
        await vi.waitFor(() => expect(fx.sentOfKind("game-ended")).toHaveLength(1));
        expect(fx.sentOfKind("game-ended")[0]).toEqual({
            kind: "game-ended",
            guildId: GUILD,
            sessionId: fx.sentOfKind("game-event")[0]?.sessionId,
            reason: "ImpostorByKill",
            winners: ["Host"],
            roster,
        });
    });

    it("passes the friend code of link-chat on to link-confirmed", async () => {
        const codes = await fx.linking.createPendingLink(GUILD, "user-1");
        const ws = await fx.authenticate();
        ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew", friendCode: "crew#42" }));
        await vi.waitFor(() => expect(fx.sentOfKind("link-confirmed")).toHaveLength(1));
        expect(fx.sentOfKind("link-confirmed")[0]).toMatchObject({ discordId: "user-1", friendCode: "crew#42" });
    });

    it("forwards router notice to plugin", async () => {
        fx.router.register(GUILD, async () => ({
            ok: true,
            notice: { code: "host-not-in-voice", message: "Join a voice channel" },
        }));
        const ws = await fx.authenticate();
        const notice = nextMessage(ws);
        ws.send(gameEvent());
        expect(await notice).toEqual({ type: "notice", code: "host-not-in-voice", message: "Join a voice channel" });
    });

    it("sends cluster-unavailable when the router fails", async () => {
        fx.router.register(GUILD, async () => ({ ok: false, error: "timeout" }));
        const ws = await fx.authenticate();
        const notice = nextMessage(ws);
        ws.send(gameEvent());
        expect(await notice).toMatchObject({ type: "notice", code: "cluster-unavailable" });
    });

    it("reconnect takes over session and old close does not end it", async () => {
        const first = await fx.authenticate();
        first.send(gameEvent("first"));
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));
        const sessionId = fx.sentOfKind("game-event")[0]?.sessionId;

        const firstClosed = waitForClose(first);
        const second = await fx.authenticate();
        expect((await firstClosed).code).toBe(4004);

        second.send(gameEvent("second"));
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(2));
        expect(fx.sentOfKind("game-event")[1]?.sessionId).toBe(sessionId);
        expect(fx.sentOfKind("session-ended")).toHaveLength(0);
        expect(fx.gateway.sessionCount()).toBe(1);
        expect(fx.gateway.isConnected(GUILD)).toBe(true);
    });

    it("ignores late messages from a replaced socket", async () => {
        const first = await fx.authenticate();
        first.pause();
        await fx.authenticate();

        expect(first.readyState).toBe(WebSocket.OPEN);
        first.send(gameEvent("stale"));
        first.send("{not json");
        const second = fx.clients[1] as WebSocket;
        second.send(gameEvent("fresh"));

        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(fx.sentOfKind("game-event").map((e) => e.hostAccountName)).toEqual(["fresh"]);
        expect(fx.gateway.isConnected(GUILD)).toBe(true);

        first.terminate();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(fx.sentOfKind("session-ended")).toHaveLength(0);
    });

    it("session-ended on normal close", async () => {
        const ws = await fx.authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));
        const sessionId = fx.sentOfKind("game-event")[0]?.sessionId;

        ws.close();
        await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(1));
        expect(fx.sentOfKind("session-ended")[0]).toEqual({ kind: "session-ended", guildId: GUILD, sessionId });
        expect(fx.gateway.isConnected(GUILD)).toBe(false);
        expect(fx.gateway.sessionCount()).toBe(0);
    });

    it("retries session-ended until the cluster answers ok", async () => {
        await fx.restart({ sessionEndRetryDelaysMs: [10, 10, 10, 10] });
        const replies: RouterReply[] = [
            { ok: false, error: "timeout" },
            { ok: false, error: "no cluster" },
        ];
        fx.router.register(GUILD, async (req) =>
            req.kind === "session-ended" ? (replies.shift() ?? { ok: true }) : { ok: true },
        );
        const ws = await fx.authenticate();

        ws.close();

        await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(3));
        await sleep(50);
        expect(fx.sentOfKind("session-ended")).toHaveLength(3);
        expect(new Set(fx.sentOfKind("session-ended").map((e) => e.sessionId)).size).toBe(1);
    });

    it("gives up retrying session-ended after the last delay", async () => {
        await fx.restart({ sessionEndRetryDelaysMs: [10, 10] });
        fx.router.register(GUILD, async (req) =>
            req.kind === "session-ended" ? { ok: false, error: "down" } : { ok: true },
        );
        const ws = await fx.authenticate();

        ws.close();

        await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(3));
        await sleep(50);
        expect(fx.sentOfKind("session-ended")).toHaveLength(3);
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("session-ended"));
    });

    it("waits for the message in flight before routing session-ended", async () => {
        let finishEvent = (): void => {};
        fx.router.register(GUILD, async (req) => {
            if (req.kind === "game-event") await new Promise<void>((resolve) => (finishEvent = resolve));
            return { ok: true };
        });
        const ws = await fx.authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));

        ws.close();
        await sleep(50);
        expect(fx.sentOfKind("session-ended")).toHaveLength(0);

        finishEvent();
        await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(1));
    });

    it("close() does not wait for session-ended retries", async () => {
        await fx.restart({ sessionEndRetryDelaysMs: [60_000] });
        fx.router.register(GUILD, async () => ({ ok: false, error: "down" }));
        await fx.authenticate();

        const startedAt = Date.now();
        await fx.gateway.close();

        expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it("does not end a session for a connection that never authenticated", async () => {
        const ws = await fx.connect();
        const closed = waitForClose(ws);
        ws.send(hello({ secret: "wrong" }));
        await closed;
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fx.router.sent).toHaveLength(0);
    });

    it("link-chat confirms and routes link-confirmed", async () => {
        const codes = await fx.linking.createPendingLink(GUILD, "user-1");
        await fx.linking.attachInteractionResponse(GUILD, "user-1", "app", "token");
        const ws = await fx.authenticate();

        ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew" }));
        await vi.waitFor(() => expect(fx.sentOfKind("link-confirmed")).toHaveLength(1));
        expect(fx.router.sent.at(-1)?.guildId).toBe(GUILD);
        expect(fx.sentOfKind("link-confirmed")[0]).toEqual({
            kind: "link-confirmed",
            guildId: GUILD,
            discordId: "user-1",
            accountName: "Crew",
            applicationId: "app",
            interactionToken: "token",
        });
        expect(await fx.linking.getLink(GUILD, "user-1")).toMatchObject({ accountName: "Crew" });
    });

    it("link-chat cannot confirm a pending link of another guild", async () => {
        const otherGuild = "guild-2";
        const codes = await fx.linking.createPendingLink(otherGuild, "user-2");
        const ws = await fx.authenticate();
        const result = nextMessage(ws);

        ws.send(JSON.stringify({ type: "link-chat", code: codes.quickChatCode, accountName: "Attacker" }));

        expect(await result).toEqual({ type: "link-result", status: "not-found", accountName: "Attacker" });
        expect(fx.sentOfKind("link-confirmed")).toHaveLength(0);
        expect(await fx.db.pendingLinks.getActive(otherGuild, "user-2", Date.now())).not.toBeNull();
    });

    it(`closes 4003 after ${LINK_CHAT_LIMIT_PER_MINUTE} link-chat messages within a minute`, async () => {
        const ws = await fx.authenticate();
        const results: unknown[] = [];
        ws.on("message", (data) => results.push(JSON.parse(data.toString())));
        const closed = waitForClose(ws);

        for (let i = 0; i <= LINK_CHAT_LIMIT_PER_MINUTE; i++) {
            ws.send(JSON.stringify({ type: "link-chat", code: `link-${i}`, accountName: "Crew" }));
        }

        expect((await closed).code).toBe(4003);
        expect(results).toHaveLength(LINK_CHAT_LIMIT_PER_MINUTE);
    });

    it("link-chat with an unknown code routes nothing", async () => {
        const ws = await fx.authenticate();
        ws.send(JSON.stringify({ type: "link-chat", code: "link-ZZZZ", accountName: "Crew" }));
        ws.send(gameEvent());
        await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(1));
        expect(fx.sentOfKind("link-confirmed")).toHaveLength(0);
    });

    it("answers link-chat with link-result linked", async () => {
        const codes = await fx.linking.createPendingLink(GUILD, "user-1");
        const ws = await fx.authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew" }));
        expect(await result).toEqual({ type: "link-result", status: "linked", accountName: "Crew" });
    });

    it("answers link-result not-found and logs when confirming the link fails", async () => {
        vi.spyOn(fx.linking, "confirmLink").mockRejectedValueOnce(new Error("database is locked"));
        const ws = await fx.authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: "link-AAAA", accountName: "Crew" }));
        expect(await result).toEqual({ type: "link-result", status: "not-found", accountName: "Crew" });
        expect(logger.error).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(Error));
        expect(logger.warn).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining("No pending link"));
    });

    it("warns about an unknown link code", async () => {
        const ws = await fx.authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: "link-ZZZZ", accountName: "Crew" }));
        await result;
        expect(logger.warn).toHaveBeenCalledWith(expect.anything(), 'No pending link found for code "link-ZZZZ"');
    });

    it("answers an unknown link code with link-result not-found", async () => {
        const ws = await fx.authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: "link-ZZZZ", accountName: "Crew" }));
        expect(await result).toEqual({ type: "link-result", status: "not-found", accountName: "Crew" });
    });

    it("plugin-log goes to the AmongUs logger with the old level mapping", async () => {
        const ws = await fx.authenticate();
        ws.send(JSON.stringify({ type: "plugin-log", level: "warning", source: "Mod", message: "careful" }));
        ws.send(JSON.stringify({ type: "plugin-log", level: "fatal", source: "Mod", message: "boom" }));
        await vi.waitFor(() => {
            expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ name: "among-us" }), "[Mod] careful");
            expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ name: "among-us" }), "[Mod] boom");
        });
    });

    it("plugin-log before hello is not accepted", async () => {
        const ws = await fx.connect();
        const closed = waitForClose(ws);
        ws.send(JSON.stringify({ type: "plugin-log", level: "info", source: "Mod", message: "sneaky" }));
        expect((await closed).code).toBe(4003);
        expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), "[Mod] sneaky");
    });

    it("pushLinkPending reaches the guild's socket and returns false without one", async () => {
        expect(fx.gateway.pushLinkPending(GUILD, "link-AAAA", "1-2", "user-1")).toBe(false);

        const ws = await fx.authenticate();
        const pending = nextMessage(ws);
        expect(fx.gateway.pushLinkPending(GUILD, "link-AAAA", "1-2", "user-1")).toBe(true);
        expect(await pending).toEqual({
            type: "link-pending",
            phrase: "link-AAAA",
            quickChatCode: "1-2",
            discordId: "user-1",
        });
        expect(fx.gateway.pushLinkPending("other-guild", "link-AAAA", "1-2", "user-1")).toBe(false);
    });

    it("terminates a socket that stops answering pings", async () => {
        await fx.restart({ pingIntervalMs: 20, pongTimeoutMs: 60 });

        const ws = await fx.authenticate({ autoPong: false });
        const closed = waitForClose(ws);
        expect((await closed).code).toBe(1006);
        await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(1));
    });

    it("terminates after pongTimeoutMs of silence, not after the next ping tick", async () => {
        // A tick-based check would only notice at the second ping (400 ms).
        await fx.restart({ pingIntervalMs: 200, pongTimeoutMs: 300 });

        const ws = await fx.authenticate({ autoPong: false });
        const startedAt = Date.now();
        await waitForClose(ws);
        const elapsed = Date.now() - startedAt;
        expect(elapsed).toBeGreaterThanOrEqual(250);
        expect(elapsed).toBeLessThan(390);
    });

    it("keeps a socket that answers pings for several pong timeout periods", async () => {
        await fx.restart({ pingIntervalMs: 20, pongTimeoutMs: 60 });

        const ws = await fx.authenticate();
        let pings = 0;
        ws.on("ping", () => pings++);
        await sleep(300);
        expect(pings).toBeGreaterThanOrEqual(5);
        expect(fx.gateway.isConnected(GUILD)).toBe(true);
        expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it("rejects a pong timeout that is not longer than the ping interval", () => {
        const deps = {
            resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }),
            router: fx.router,
            linking: fx.linking,
        };
        expect(() => new PluginGateway({ ...deps, pingIntervalMs: 100, pongTimeoutMs: 100 })).toThrow(
            /pongTimeoutMs \(100\) must be greater than pingIntervalMs \(100\)/,
        );
        expect(() => new PluginGateway({ ...deps, pingIntervalMs: 100, pongTimeoutMs: 101 })).not.toThrow();
    });

    it("close() still resolves when the router never answers", async () => {
        await fx.restart({ routeTimeoutMs: 50 });
        fx.router.register(GUILD, () => new Promise(() => {}));
        await fx.authenticate();

        const startedAt = Date.now();
        await fx.gateway.close();
        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(fx.sentOfKind("session-ended")).toHaveLength(1);
    });

    it("game-event times out to cluster-unavailable on a dead router", async () => {
        await fx.restart({ routeTimeoutMs: 50 });
        fx.router.register(GUILD, () => new Promise(() => {}));
        const ws = await fx.authenticate();
        const notice = nextMessage(ws);
        ws.send(gameEvent());
        expect(await notice).toMatchObject({ type: "notice", code: "cluster-unavailable" });
    });

    it("blocked hello is closed with 4005", async () => {
        await fx.restart({ resolver: { resolve: async () => ({ guildId: GUILD, blocked: true }) } });
        const ws = await fx.connect();
        const closed = waitForClose(ws);
        ws.send(hello());

        expect(await closed).toEqual({ code: 4005, reason: "Blocked" });
        expect(logger.warn).toHaveBeenCalledWith(
            expect.anything(),
            `Rejected plugin connection for blocked guild ${GUILD}`,
        );
        expect(fx.gateway.sessionCount()).toBe(0);
        expect(fx.sentOfKind("session-started")).toHaveLength(0);
    });

    it("a blocked host's session is closed with 4005 after the notice", async () => {
        const notice = {
            code: "host-blocked" as const,
            message: "The host of this game is blocked from using this bot.",
        };
        fx.router.register(GUILD, async () => ({ ok: true, notice }));
        const ws = await fx.authenticate();
        const received = nextMessage(ws);
        const closed = waitForClose(ws);

        ws.send(gameEvent());

        expect(await received).toEqual({ type: "notice", ...notice });
        expect(await closed).toEqual({ code: 4005, reason: "Blocked" });
        await vi.waitFor(() => expect(fx.sentOfKind("session-ended")).toHaveLength(1));
    });

    it("other notices keep the session open", async () => {
        fx.router.register(GUILD, async () => ({
            ok: true,
            notice: { code: "host-not-linked", message: "Link first" },
        }));
        const ws = await fx.authenticate();
        const received = nextMessage(ws);

        ws.send(gameEvent());

        expect(await received).toMatchObject({ type: "notice", code: "host-not-linked" });
        await sleep(50);
        expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it("close() resolves only after session-ended was routed", async () => {
        let routed = false;
        fx.router.register(GUILD, async (req) => {
            if (req.kind === "session-ended") {
                await sleep(30);
                routed = true;
            }
            return { ok: true };
        });
        await fx.authenticate();

        await fx.gateway.close();
        expect(routed).toBe(true);
        expect(fx.sentOfKind("session-ended")).toHaveLength(1);
        expect(fx.gateway.sessionCount()).toBe(0);
    });
});
