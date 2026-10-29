import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Database } from "../../src/Data/database";
import { type GatewayObserver, PluginGateway } from "../../src/Gateway/PluginGateway";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { logger } from "../../src/Logging/logger";
import { PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { LinkingService } from "../../src/Utils/LinkingService";
import { createTestDatabase } from "../helpers/testDatabase";

const SECRET = "[REDACTED:API key param]";
const GUILD = "guild-1";

function hello(pluginVersion = "3.0.0"): string {
    return JSON.stringify({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        secret: SECRET,
        pluginVersion,
        gameVersion: "2026.9.29",
    });
}

function gameEvent(event = "game-start"): string {
    return JSON.stringify({ type: "game-event", event, hostAccountName: "Host", players: ["Host"], deadPlayers: [] });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));
}

function spyObserver() {
    return {
        sessionStarted: vi.fn<GatewayObserver["sessionStarted"]>(),
        sessionEnded: vi.fn<GatewayObserver["sessionEnded"]>(),
        pluginMessage: vi.fn<GatewayObserver["pluginMessage"]>(),
        gameEventApplied: vi.fn<GatewayObserver["gameEventApplied"]>(),
    };
}

describe("PluginGateway observer", () => {
    let server: Server;
    let gateway: PluginGateway;
    let router: InMemoryClusterRouter;
    let db: Database;
    let linking: LinkingService;
    let url: string;
    const clients: WebSocket[] = [];

    async function start(observer: GatewayObserver): Promise<void> {
        gateway = new PluginGateway({
            resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }),
            router,
            linking,
            observer,
        });
        server = createServer();
        gateway.attach(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
    }

    async function authenticate(pluginVersion?: string): Promise<WebSocket> {
        const ws = new WebSocket(url);
        clients.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const welcome = nextMessage(ws);
        ws.send(hello(pluginVersion));
        await welcome;
        return ws;
    }

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        router = new InMemoryClusterRouter();
        router.register(GUILD, async () => ({ ok: true }));
        db = await createTestDatabase();
        linking = new LinkingService(db);
    });

    afterEach(async () => {
        for (const ws of clients.splice(0)) ws.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.close();
        vi.restoreAllMocks();
    });

    it("observer sees session start, events and end", async () => {
        const observer = spyObserver();
        await start(observer);
        const ws = await authenticate();
        expect(observer.sessionStarted).toHaveBeenCalledWith(
            expect.objectContaining({ guildId: GUILD, pluginVersion: "3.0.0" }),
        );

        ws.send(gameEvent("game-start"));
        await vi.waitFor(() => expect(observer.gameEventApplied).toHaveBeenCalledTimes(1));
        expect(observer.pluginMessage).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD }), "game-start");
        expect(observer.gameEventApplied).toHaveBeenCalledWith(expect.anything(), "game-start", { ok: true });

        ws.send(JSON.stringify({ type: "link-chat", code: "link-ZZZZ", accountName: "Crew" }));
        await vi.waitFor(() => expect(observer.pluginMessage).toHaveBeenCalledWith(expect.anything(), "link-chat"));

        ws.close();
        await vi.waitFor(() => expect(observer.sessionEnded).toHaveBeenCalledTimes(1));
        expect(observer.sessionEnded).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD }));
    });

    it("takeover reports the new session and no end for the old socket", async () => {
        const observer = spyObserver();
        await start(observer);
        const first = await authenticate("3.0.0");
        const firstClosed = new Promise<void>((resolve) => first.once("close", () => resolve()));
        await authenticate("3.0.1");
        await firstClosed;
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(observer.sessionStarted).toHaveBeenCalledTimes(2);
        expect(observer.sessionStarted.mock.calls[1]?.[0]).toMatchObject({ pluginVersion: "3.0.1" });
        expect(observer.sessionEnded).not.toHaveBeenCalled();
    });

    it("a throwing observer does not break event routing", async () => {
        const throwing = (): never => {
            throw new Error("observer broke");
        };
        await start({
            sessionStarted: throwing,
            sessionEnded: throwing,
            pluginMessage: throwing,
            gameEventApplied: throwing,
        });
        router.register(GUILD, async () => ({ ok: true, notice: { code: "host-not-in-voice", message: "Join" } }));
        const ws = await authenticate();
        const notice = nextMessage(ws);
        ws.send(gameEvent());
        expect(await notice).toEqual({ type: "notice", code: "host-not-in-voice", message: "Join" });
        expect(logger.debug).toHaveBeenCalled();
        ws.close();
        await vi.waitFor(() => expect(router.sent.some((s) => s.req.kind === "session-ended")).toBe(true));
    });
});
