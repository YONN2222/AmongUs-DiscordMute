import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Database } from "../../src/Data/Database";
import { createGatewayRequestHandler } from "../../src/Gateway/GatewayRequestHandler";
import { MAX_SESSIONS_PER_GUILD, PluginGateway, type PluginGatewayDeps } from "../../src/Gateway/PluginGateway";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { LinkingService } from "../../src/Linking/LinkingService";
import { logger } from "../../src/Logging/Logger";
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import type { ClusterRequest, RouterReply } from "../../src/Routing/Messages";
import { createTestDatabase } from "../Helpers/TestDatabase";

const SECRET = "test-secret";
const GUILD = "guild-1";

interface Closed {
    code: number;
    reason: string;
}

function hello(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        secret: SECRET,
        pluginVersion: "2.0.0",
        gameVersion: "2026.9.1",
        ...overrides,
    });
}

function gameEvent(hostAccountName = "Host"): string {
    return JSON.stringify({
        type: "game-event",
        event: "game-start",
        hostAccountName,
        players: ["Host", "Crew"],
        deadPlayers: [],
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForClose(ws: WebSocket): Promise<Closed> {
    return new Promise((resolve) => {
        ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    });
}

describe("PluginGateway", () => {
    let server: Server;
    let gateway: PluginGateway;
    let router: InMemoryClusterRouter;
    let db: Database;
    let linking: LinkingService;
    let url: string;
    const clients: WebSocket[] = [];

    function connect(options?: ConstructorParameters<typeof WebSocket>[2]): Promise<WebSocket> {
        const ws = new WebSocket(url, options);
        clients.push(ws);
        return new Promise((resolve, reject) => {
            ws.once("open", () => resolve(ws));
            ws.once("error", reject);
        });
    }

    async function authenticate(options?: ConstructorParameters<typeof WebSocket>[2]): Promise<WebSocket> {
        const ws = await connect(options);
        const welcome = nextMessage(ws);
        ws.send(hello());
        expect(await welcome).toEqual({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
        return ws;
    }

    function sentOfKind<K extends ClusterRequest["kind"]>(kind: K): Extract<ClusterRequest, { kind: K }>[] {
        return router.sent
            .map((entry) => entry.req)
            .filter((req): req is Extract<ClusterRequest, { kind: K }> => req.kind === kind);
    }

    async function start(options: Partial<Omit<PluginGatewayDeps, "router" | "linking">>) {
        gateway = new PluginGateway({
            resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }),
            router,
            linking,
            ...options,
        });
        server = createServer();
        gateway.attach(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
    }

    async function restart(options: Parameters<typeof start>[0]): Promise<void> {
        await gateway.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await start(options);
    }

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        router = new InMemoryClusterRouter();
        router.register(GUILD, async () => ({ ok: true }));
        db = await createTestDatabase();
        linking = new LinkingService(db);
        await start({ helloTimeoutMs: 100 });
    });

    afterEach(async () => {
        for (const ws of clients.splice(0)) ws.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.close();
        vi.restoreAllMocks();
    });

    it("closes 4000 without hello", async () => {
        const ws = await connect();
        expect((await waitForClose(ws)).code).toBe(4000);
    });

    it("closes 4001 on wrong secret", async () => {
        const ws = await connect();
        const closed = waitForClose(ws);
        ws.send(hello({ secret: "wrong" }));
        expect((await closed).code).toBe(4001);
        expect(gateway.isConnected(GUILD)).toBe(false);
    });

    it("closes 4002 on old protocol", async () => {
        const ws = await connect();
        const closed = waitForClose(ws);
        ws.send(hello({ protocolVersion: MIN_PROTOCOL_VERSION - 1 }));
        expect(await closed).toEqual({ code: 4002, reason: "Plugin outdated, please update DiscordMute" });
    });

    it("closes 4003 on an invalid message after hello", async () => {
        const ws = await authenticate();
        const closed = waitForClose(ws);
        ws.send("{not json");
        expect((await closed).code).toBe(4003);
    });

    it("tells a 2.x plugin, which sends the secret in the URL query, to update", async () => {
        url = `${url}?secret=${SECRET}`;
        const ws = await connect();
        expect(await waitForClose(ws)).toEqual({ code: 4002, reason: "Plugin outdated, please update DiscordMute" });
        expect(logger.warn).toHaveBeenCalledWith(
            expect.anything(),
            "DiscordMute plugin 2.x connected, please update the plugin",
        );
        expect(gateway.isConnected(GUILD)).toBe(false);
    });

    it("welcome after valid hello", async () => {
        await authenticate();
        expect(gateway.isConnected(GUILD)).toBe(true);
        expect(gateway.sessionCount()).toBe(1);
    });

    it("routes game-event to the guild with the session id", async () => {
        const ws = await authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));

        const [event] = sentOfKind("game-event");
        expect(router.sent[0]?.guildId).toBe(GUILD);
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
        const ws = await connect();
        const welcome = nextMessage(ws);
        ws.send(hello({ protocolVersion: 2, pluginVersion: "3.0.0" }));
        expect(await welcome).toEqual({ type: "welcome", protocolVersion: 3 });
        expect(gateway.isConnected(GUILD)).toBe(true);

        await vi.waitFor(() => expect(sentOfKind("session-started")).toHaveLength(1));
        expect(sentOfKind("session-started")[0]).toEqual({
            kind: "session-started",
            guildId: GUILD,
            sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
            pluginVersion: "3.0.0",
            gameVersion: "2026.9.1",
            protocolVersion: 2,
        });
    });

    it("stays active when session-started is not answered", async () => {
        await restart({ routeTimeoutMs: 50 });
        router.register(GUILD, (req) =>
            req.kind === "session-started" ? new Promise<RouterReply>(() => {}) : Promise.resolve({ ok: true }),
        );
        const ws = await authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));
        await vi.waitFor(() =>
            expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("session-started")),
        );
        expect(gateway.isConnected(GUILD)).toBe(true);
    });

    it("forwards roster and lobby code of a v3 game-event", async () => {
        const ws = await authenticate();
        const roster = [{ name: "Host", friendCode: "host#1", dead: false, disconnected: false }];
        ws.send(JSON.stringify({ ...JSON.parse(gameEvent()), roster, lobbyCode: "ABCDEF" }));
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));
        expect(sentOfKind("game-event")[0]).toMatchObject({ roster, lobbyCode: "ABCDEF" });
    });

    it("routes game-end as game-ended in the same session as the game events", async () => {
        const ws = await authenticate();
        const roster = [{ name: "Crew", dead: true, disconnected: false }];
        ws.send(gameEvent());
        ws.send(JSON.stringify({ type: "game-end", reason: "ImpostorByKill", winners: ["Host"], roster }));
        await vi.waitFor(() => expect(sentOfKind("game-ended")).toHaveLength(1));
        expect(sentOfKind("game-ended")[0]).toEqual({
            kind: "game-ended",
            guildId: GUILD,
            sessionId: sentOfKind("game-event")[0]?.sessionId,
            reason: "ImpostorByKill",
            winners: ["Host"],
            roster,
        });
    });

    it("passes the friend code of link-chat on to link-confirmed", async () => {
        const codes = await linking.createPendingLink(GUILD, "user-1");
        const ws = await authenticate();
        ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew", friendCode: "crew#42" }));
        await vi.waitFor(() => expect(sentOfKind("link-confirmed")).toHaveLength(1));
        expect(sentOfKind("link-confirmed")[0]).toMatchObject({ discordId: "user-1", friendCode: "crew#42" });
    });

    it("forwards router notice to plugin", async () => {
        router.register(GUILD, async () => ({
            ok: true,
            notice: { code: "host-not-in-voice", message: "Join a voice channel" },
        }));
        const ws = await authenticate();
        const notice = nextMessage(ws);
        ws.send(gameEvent());
        expect(await notice).toEqual({ type: "notice", code: "host-not-in-voice", message: "Join a voice channel" });
    });

    it("sends cluster-unavailable when the router fails", async () => {
        router.register(GUILD, async () => ({ ok: false, error: "timeout" }));
        const ws = await authenticate();
        const notice = nextMessage(ws);
        ws.send(gameEvent());
        expect(await notice).toMatchObject({ type: "notice", code: "cluster-unavailable" });
    });

    it("reconnect takes over session and old close does not end it", async () => {
        const first = await authenticate();
        first.send(gameEvent("first"));
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));
        const sessionId = sentOfKind("game-event")[0]?.sessionId;

        const firstClosed = waitForClose(first);
        const second = await authenticate();
        expect((await firstClosed).code).toBe(4004);

        second.send(gameEvent("second"));
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(2));
        expect(sentOfKind("game-event")[1]?.sessionId).toBe(sessionId);
        expect(sentOfKind("session-ended")).toHaveLength(0);
        expect(gateway.sessionCount()).toBe(1);
        expect(gateway.isConnected(GUILD)).toBe(true);
    });

    it("ignores late messages from a replaced socket", async () => {
        const first = await authenticate();
        first.pause();
        await authenticate();

        expect(first.readyState).toBe(WebSocket.OPEN);
        first.send(gameEvent("stale"));
        first.send("{not json");
        const second = clients[1] as WebSocket;
        second.send(gameEvent("fresh"));

        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(sentOfKind("game-event").map((e) => e.hostAccountName)).toEqual(["fresh"]);
        expect(gateway.isConnected(GUILD)).toBe(true);

        first.terminate();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(sentOfKind("session-ended")).toHaveLength(0);
    });

    it("session-ended on normal close", async () => {
        const ws = await authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));
        const sessionId = sentOfKind("game-event")[0]?.sessionId;

        ws.close();
        await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(1));
        expect(sentOfKind("session-ended")[0]).toEqual({ kind: "session-ended", guildId: GUILD, sessionId });
        expect(gateway.isConnected(GUILD)).toBe(false);
        expect(gateway.sessionCount()).toBe(0);
    });

    it("retries session-ended until the cluster answers ok", async () => {
        await restart({ sessionEndRetryDelaysMs: [10, 10, 10, 10] });
        const replies: RouterReply[] = [
            { ok: false, error: "timeout" },
            { ok: false, error: "no cluster" },
        ];
        router.register(GUILD, async (req) =>
            req.kind === "session-ended" ? (replies.shift() ?? { ok: true }) : { ok: true },
        );
        const ws = await authenticate();

        ws.close();

        await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(3));
        await sleep(50);
        expect(sentOfKind("session-ended")).toHaveLength(3);
        expect(new Set(sentOfKind("session-ended").map((e) => e.sessionId)).size).toBe(1);
    });

    it("gives up retrying session-ended after the last delay", async () => {
        await restart({ sessionEndRetryDelaysMs: [10, 10] });
        router.register(GUILD, async (req) =>
            req.kind === "session-ended" ? { ok: false, error: "down" } : { ok: true },
        );
        const ws = await authenticate();

        ws.close();

        await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(3));
        await sleep(50);
        expect(sentOfKind("session-ended")).toHaveLength(3);
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("session-ended"));
    });

    it("waits for the message in flight before routing session-ended", async () => {
        let finishEvent = (): void => {};
        router.register(GUILD, async (req) => {
            if (req.kind === "game-event") await new Promise<void>((resolve) => (finishEvent = resolve));
            return { ok: true };
        });
        const ws = await authenticate();
        ws.send(gameEvent());
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));

        ws.close();
        await sleep(50);
        expect(sentOfKind("session-ended")).toHaveLength(0);

        finishEvent();
        await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(1));
    });

    it("close() does not wait for session-ended retries", async () => {
        await restart({ sessionEndRetryDelaysMs: [60_000] });
        router.register(GUILD, async () => ({ ok: false, error: "down" }));
        await authenticate();

        const startedAt = Date.now();
        await gateway.close();

        expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it("does not end a session for a connection that never authenticated", async () => {
        const ws = await connect();
        const closed = waitForClose(ws);
        ws.send(hello({ secret: "wrong" }));
        await closed;
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(router.sent).toHaveLength(0);
    });

    it("link-chat confirms and routes link-confirmed", async () => {
        const codes = await linking.createPendingLink(GUILD, "user-1");
        await linking.attachInteractionResponse(GUILD, "user-1", "app", "token");
        const ws = await authenticate();

        ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew" }));
        await vi.waitFor(() => expect(sentOfKind("link-confirmed")).toHaveLength(1));
        expect(router.sent.at(-1)?.guildId).toBe(GUILD);
        expect(sentOfKind("link-confirmed")[0]).toEqual({
            kind: "link-confirmed",
            guildId: GUILD,
            discordId: "user-1",
            accountName: "Crew",
            applicationId: "app",
            interactionToken: "token",
        });
        expect(await linking.getLink(GUILD, "user-1")).toMatchObject({ accountName: "Crew" });
    });

    it("link-chat with an unknown code routes nothing", async () => {
        const ws = await authenticate();
        ws.send(JSON.stringify({ type: "link-chat", code: "link-ZZZZ", accountName: "Crew" }));
        ws.send(gameEvent());
        await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));
        expect(sentOfKind("link-confirmed")).toHaveLength(0);
    });

    it("answers link-chat with link-result linked", async () => {
        const codes = await linking.createPendingLink(GUILD, "user-1");
        const ws = await authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew" }));
        expect(await result).toEqual({ type: "link-result", status: "linked", accountName: "Crew" });
    });

    it("answers link-result not-found and logs when confirming the link fails", async () => {
        vi.spyOn(linking, "confirmLink").mockRejectedValueOnce(new Error("database is locked"));
        const ws = await authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: "link-AAAA", accountName: "Crew" }));
        expect(await result).toEqual({ type: "link-result", status: "not-found", accountName: "Crew" });
        expect(logger.error).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(Error));
        expect(logger.warn).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining("No pending link"));
    });

    it("warns about an unknown link code", async () => {
        const ws = await authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: "link-ZZZZ", accountName: "Crew" }));
        await result;
        expect(logger.warn).toHaveBeenCalledWith(expect.anything(), 'No pending link found for code "link-ZZZZ"');
    });

    it("answers an unknown link code with link-result not-found", async () => {
        const ws = await authenticate();
        const result = nextMessage(ws);
        ws.send(JSON.stringify({ type: "link-chat", code: "link-ZZZZ", accountName: "Crew" }));
        expect(await result).toEqual({ type: "link-result", status: "not-found", accountName: "Crew" });
    });

    it("plugin-log goes to the AmongUs logger with the old level mapping", async () => {
        const ws = await authenticate();
        ws.send(JSON.stringify({ type: "plugin-log", level: "warning", source: "Mod", message: "careful" }));
        ws.send(JSON.stringify({ type: "plugin-log", level: "fatal", source: "Mod", message: "boom" }));
        await vi.waitFor(() => {
            expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ name: "among-us" }), "[Mod] careful");
            expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ name: "among-us" }), "[Mod] boom");
        });
    });

    it("plugin-log before hello is not accepted", async () => {
        const ws = await connect();
        const closed = waitForClose(ws);
        ws.send(JSON.stringify({ type: "plugin-log", level: "info", source: "Mod", message: "sneaky" }));
        expect((await closed).code).toBe(4003);
        expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), "[Mod] sneaky");
    });

    it("pushLinkPending reaches the guild's socket and returns false without one", async () => {
        expect(gateway.pushLinkPending(GUILD, "link-AAAA", "1-2", "user-1")).toBe(false);

        const ws = await authenticate();
        const pending = nextMessage(ws);
        expect(gateway.pushLinkPending(GUILD, "link-AAAA", "1-2", "user-1")).toBe(true);
        expect(await pending).toEqual({
            type: "link-pending",
            phrase: "link-AAAA",
            quickChatCode: "1-2",
            discordId: "user-1",
        });
        expect(gateway.pushLinkPending("other-guild", "link-AAAA", "1-2", "user-1")).toBe(false);
    });

    describe("parallel sessions", () => {
        const keyOf = (n: number) => n.toString(16).padStart(32, "0");

        async function authenticateWithKey(connectionKey?: string): Promise<WebSocket> {
            const ws = await connect();
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

            await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(2));
            const ids = new Set(sentOfKind("game-event").map((e) => e.sessionId));
            expect(ids.size).toBe(2);
            expect(first.readyState).toBe(WebSocket.OPEN);
            expect(second.readyState).toBe(WebSocket.OPEN);
            expect(gateway.sessionsOfGuild(GUILD)).toBe(2);
            expect(gateway.sessionCount()).toBe(2);

            first.close();
            await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(1));
            expect(gateway.isConnected(GUILD)).toBe(true);
            expect(gateway.sessionsOfGuild(GUILD)).toBe(1);
        });

        it("same connection key replaces with 4004", async () => {
            const first = await authenticateWithKey(keyOf(1));
            const firstClosed = waitForClose(first);
            await authenticateWithKey(keyOf(1));

            expect((await firstClosed).code).toBe(4004);
            expect(gateway.sessionsOfGuild(GUILD)).toBe(1);
            expect(sentOfKind("session-ended")).toHaveLength(0);
        });

        it("missing connection key behaves like before", async () => {
            const keyed = await authenticateWithKey(keyOf(1));
            const first = await authenticateWithKey();
            const firstClosed = waitForClose(first);
            await authenticateWithKey();

            expect((await firstClosed).code).toBe(4004);
            expect(keyed.readyState).toBe(WebSocket.OPEN);
            expect(gateway.sessionsOfGuild(GUILD)).toBe(2);
        });

        it("26th session in a guild is closed with 4006", async () => {
            for (let n = 1; n <= MAX_SESSIONS_PER_GUILD; n++) await authenticateWithKey(keyOf(n));
            expect(gateway.sessionsOfGuild(GUILD)).toBe(25);

            const extra = await connect();
            const closed = waitForClose(extra);
            extra.send(hello({ connectionKey: keyOf(26) }));

            expect(await closed).toEqual({ code: 4006, reason: "Too many games on this server" });
            expect(gateway.sessionsOfGuild(GUILD)).toBe(25);

            const replacing = await authenticateWithKey(keyOf(25));
            expect(replacing.readyState).toBe(WebSocket.OPEN);
            expect(gateway.sessionsOfGuild(GUILD)).toBe(25);
        });

        it("pushLinkPending reaches every session of the guild", async () => {
            const sockets = [await authenticateWithKey(keyOf(1)), await authenticateWithKey(keyOf(2))];
            const pending = sockets.map((ws) => nextMessage(ws));

            expect(gateway.pushLinkPending(GUILD, "link-AAAA", "1-2", "user-1")).toBe(true);

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

            expect(gateway.disconnectGuild(GUILD, 4005, "Blocked")).toBe(2);

            for (const result of await Promise.all(closed)) expect(result).toEqual({ code: 4005, reason: "Blocked" });
            await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(2));
            expect(new Set(sentOfKind("session-ended").map((e) => e.sessionId)).size).toBe(2);
            expect(gateway.isConnected(GUILD)).toBe(false);
            expect(gateway.disconnectGuild(GUILD, 4005, "Blocked")).toBe(0);
        });

        it("rotating the secret disconnects every session of the guild", async () => {
            const sockets = [await authenticateWithKey(keyOf(1)), await authenticateWithKey(keyOf(2))];
            const closed = sockets.map((ws) => waitForClose(ws));

            const reply = createGatewayRequestHandler(gateway)({
                kind: "disconnect-guild",
                guildId: GUILD,
                code: 4001,
                reason: "Secret rotated",
            });

            expect(reply).toEqual({ ok: true });
            for (const result of await Promise.all(closed)) {
                expect(result).toEqual({ code: 4001, reason: "Secret rotated" });
            }
            await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(2));
        });
    });

    it("terminates a socket that stops answering pings", async () => {
        await restart({ pingIntervalMs: 20, pongTimeoutMs: 60 });

        const ws = await authenticate({ autoPong: false });
        const closed = waitForClose(ws);
        expect((await closed).code).toBe(1006);
        await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(1));
    });

    it("terminates after pongTimeoutMs of silence, not after the next ping tick", async () => {
        // A tick-based check would only notice at the second ping (400 ms).
        await restart({ pingIntervalMs: 200, pongTimeoutMs: 300 });

        const ws = await authenticate({ autoPong: false });
        const startedAt = Date.now();
        await waitForClose(ws);
        const elapsed = Date.now() - startedAt;
        expect(elapsed).toBeGreaterThanOrEqual(250);
        expect(elapsed).toBeLessThan(390);
    });

    it("keeps a socket that answers pings for several pong timeout periods", async () => {
        await restart({ pingIntervalMs: 20, pongTimeoutMs: 60 });

        const ws = await authenticate();
        let pings = 0;
        ws.on("ping", () => pings++);
        await sleep(300);
        expect(pings).toBeGreaterThanOrEqual(5);
        expect(gateway.isConnected(GUILD)).toBe(true);
        expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it("rejects a pong timeout that is not longer than the ping interval", () => {
        const deps = { resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }), router, linking };
        expect(() => new PluginGateway({ ...deps, pingIntervalMs: 100, pongTimeoutMs: 100 })).toThrow(
            /pongTimeoutMs \(100\) must be greater than pingIntervalMs \(100\)/,
        );
        expect(() => new PluginGateway({ ...deps, pingIntervalMs: 100, pongTimeoutMs: 101 })).not.toThrow();
    });

    describe("backpressure", () => {
        it("closes 4003 when flooded before the session is active", async () => {
            await restart({
                resolver: {
                    resolve: async () => {
                        await sleep(50);
                        return { guildId: GUILD };
                    },
                },
            });
            const ws = await connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            for (let i = 0; i < 30; i++) ws.send(gameEvent(`flood-${i}`));

            expect((await closed).code).toBe(4003);
            await sleep(80);
            expect(sentOfKind("game-event")).toHaveLength(0);
            expect(gateway.sessionCount()).toBe(0);
        });

        it("accepts a burst up to the limit before the session is active", async () => {
            await restart({
                resolver: {
                    resolve: async () => {
                        await sleep(50);
                        return { guildId: GUILD };
                    },
                },
            });
            const ws = await connect();
            ws.send(hello());
            for (let i = 0; i < 15; i++) ws.send(gameEvent(`burst-${i}`));

            await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(15));
            expect(ws.readyState).toBe(WebSocket.OPEN);
        });

        it("closes 4003 when flooded after auth while the router is slow", async () => {
            await restart({ routeTimeoutMs: 200 });
            router.register(GUILD, async (req) => {
                if (req.kind === "game-event") await sleep(1000);
                return { ok: true };
            });
            const ws = await authenticate();
            const closed = waitForClose(ws);
            for (let i = 0; i < 100; i++) ws.send(gameEvent(`flood-${i}`));

            expect((await closed).code).toBe(4003);
            expect(sentOfKind("game-event").length).toBeLessThanOrEqual(1);
        });
    });

    it("close() still resolves when the router never answers", async () => {
        await restart({ routeTimeoutMs: 50 });
        router.register(GUILD, () => new Promise(() => {}));
        await authenticate();

        const startedAt = Date.now();
        await gateway.close();
        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(sentOfKind("session-ended")).toHaveLength(1);
    });

    it("game-event times out to cluster-unavailable on a dead router", async () => {
        await restart({ routeTimeoutMs: 50 });
        router.register(GUILD, () => new Promise(() => {}));
        const ws = await authenticate();
        const notice = nextMessage(ws);
        ws.send(gameEvent());
        expect(await notice).toMatchObject({ type: "notice", code: "cluster-unavailable" });
    });

    describe("message ordering", () => {
        const delayedResolver = {
            resolve: async (secret: string) => {
                await sleep(20);
                return secret === SECRET ? { guildId: GUILD } : null;
            },
        };

        it("routes a game-event sent right after hello while the secret is still resolving", async () => {
            await restart({ resolver: delayedResolver });
            const ws = await connect();
            ws.send(hello());
            ws.send(gameEvent("early"));

            await vi.waitFor(() => expect(sentOfKind("game-event")).toHaveLength(1));
            expect(sentOfKind("game-event")[0]?.hostAccountName).toBe("early");
        });

        it("discards messages queued behind a rejected hello", async () => {
            await restart({ resolver: delayedResolver });
            const ws = await connect();
            const closed = waitForClose(ws);
            ws.send(hello({ secret: "wrong" }));
            ws.send(gameEvent("intruder"));

            expect((await closed).code).toBe(4001);
            await sleep(30);
            expect(router.sent).toHaveLength(0);
        });

        it("handles messages in send order even when one is slow", async () => {
            const codes = await linking.createPendingLink(GUILD, "user-1");
            const realConfirm = linking.confirmLink.bind(linking);
            vi.spyOn(linking, "confirmLink").mockImplementation(async (code, accountName) => {
                await sleep(40);
                return realConfirm(code, accountName);
            });
            const ws = await authenticate();

            ws.send(JSON.stringify({ type: "link-chat", code: codes.phrase, accountName: "Crew" }));
            ws.send(gameEvent("first"));
            ws.send(gameEvent("second"));

            const fromPlugin = () => router.sent.filter(({ req }) => req.kind !== "session-started");
            await vi.waitFor(() => expect(fromPlugin()).toHaveLength(3));
            expect(fromPlugin().map(({ req }) => (req.kind === "game-event" ? req.hostAccountName : req.kind))).toEqual(
                ["link-confirmed", "first", "second"],
            );
        });
    });

    it("blocked hello is closed with 4005", async () => {
        await restart({ resolver: { resolve: async () => ({ guildId: GUILD, blocked: true }) } });
        const ws = await connect();
        const closed = waitForClose(ws);
        ws.send(hello());

        expect(await closed).toEqual({ code: 4005, reason: "Blocked" });
        expect(logger.warn).toHaveBeenCalledWith(
            expect.anything(),
            `Rejected plugin connection for blocked guild ${GUILD}`,
        );
        expect(gateway.sessionCount()).toBe(0);
        expect(sentOfKind("session-started")).toHaveLength(0);
    });

    it("a blocked host's session is closed with 4005 after the notice", async () => {
        const notice = {
            code: "host-blocked" as const,
            message: "The host of this game is blocked from using this bot.",
        };
        router.register(GUILD, async () => ({ ok: true, notice }));
        const ws = await authenticate();
        const received = nextMessage(ws);
        const closed = waitForClose(ws);

        ws.send(gameEvent());

        expect(await received).toEqual({ type: "notice", ...notice });
        expect(await closed).toEqual({ code: 4005, reason: "Blocked" });
        await vi.waitFor(() => expect(sentOfKind("session-ended")).toHaveLength(1));
    });

    it("other notices keep the session open", async () => {
        router.register(GUILD, async () => ({
            ok: true,
            notice: { code: "host-not-linked", message: "Link first" },
        }));
        const ws = await authenticate();
        const received = nextMessage(ws);

        ws.send(gameEvent());

        expect(await received).toMatchObject({ type: "notice", code: "host-not-linked" });
        await sleep(50);
        expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    describe("resolver failures", () => {
        it("closes 4001 when the resolver throws synchronously", async () => {
            await restart({
                resolver: {
                    resolve: () => {
                        throw new Error("boom");
                    },
                },
            });
            const ws = await connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            expect((await closed).code).toBe(4001);
        });

        it("closes 4001 when the resolver rejects", async () => {
            await restart({ resolver: { resolve: async () => Promise.reject(new Error("db down")) } });
            const ws = await connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            expect((await closed).code).toBe(4001);
        });

        it("closes 4000 when the resolver never answers", async () => {
            await restart({ helloTimeoutMs: 50, resolver: { resolve: () => new Promise(() => {}) } });
            const ws = await connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            expect((await closed).code).toBe(4000);
            expect(gateway.sessionCount()).toBe(0);
        });
    });

    it("close() resolves only after session-ended was routed", async () => {
        let routed = false;
        router.register(GUILD, async (req) => {
            if (req.kind === "session-ended") {
                await sleep(30);
                routed = true;
            }
            return { ok: true };
        });
        await authenticate();

        await gateway.close();
        expect(routed).toBe(true);
        expect(sentOfKind("session-ended")).toHaveLength(1);
        expect(gateway.sessionCount()).toBe(0);
    });
});
