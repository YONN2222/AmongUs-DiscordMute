import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { WebSocket } from "ws";
import type { Database } from "../../src/Data/Database";
import { PluginGateway, type PluginGatewayDeps } from "../../src/Gateway/PluginGateway";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { LinkingService } from "../../src/Linking/LinkingService";
import { logger } from "../../src/Logging/Logger";
import { PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import type { ClusterRequest } from "../../src/Routing/Messages";
import { createTestDatabase } from "./TestDatabase";

export const SECRET = "test-secret";
export const GUILD = "guild-1";

export interface Closed {
    code: number;
    reason: string;
}

export function hello(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        secret: SECRET,
        pluginVersion: "2.0.0",
        gameVersion: "2026.9.1",
        ...overrides,
    });
}

export function gameEvent(hostAccountName = "Host"): string {
    return JSON.stringify({
        type: "game-event",
        event: "game-start",
        hostAccountName,
        players: ["Host", "Crew"],
        deadPlayers: [],
    });
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForClose(ws: WebSocket): Promise<Closed> {
    return new Promise((resolve) => {
        ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
}

export function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    });
}

type ClientOptions = ConstructorParameters<typeof WebSocket>[2];
type StartOptions = Partial<Omit<PluginGatewayDeps, "router" | "linking">>;

/** A running gateway on a random local port; a test may restart it with other options. */
export interface PluginGatewayFixture {
    server: Server;
    gateway: PluginGateway;
    router: InMemoryClusterRouter;
    db: Database;
    linking: LinkingService;
    url: string;
    /** Every socket a test opened; all of them are terminated after the test. */
    clients: WebSocket[];
    connect(options?: ClientOptions): Promise<WebSocket>;
    /** Connects and completes the hello, expecting the welcome. */
    authenticate(options?: ClientOptions): Promise<WebSocket>;
    sentOfKind<K extends ClusterRequest["kind"]>(kind: K): Extract<ClusterRequest, { kind: K }>[];
    start(options: StartOptions): Promise<void>;
    restart(options: StartOptions): Promise<void>;
}

/** Call inside a describe: starts a self-host gateway (hello timeout 100 ms) before each test and stops it after. */
export function usePluginGatewayFixture(): PluginGatewayFixture {
    const fx = {
        clients: [] as WebSocket[],

        connect(options?: ClientOptions): Promise<WebSocket> {
            const ws = new WebSocket(fx.url, options);
            fx.clients.push(ws);
            return new Promise((resolve, reject) => {
                ws.once("open", () => resolve(ws));
                ws.once("error", reject);
            });
        },

        async authenticate(options?: ClientOptions): Promise<WebSocket> {
            const ws = await fx.connect(options);
            const welcome = nextMessage(ws);
            ws.send(hello());
            expect(await welcome).toEqual({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
            return ws;
        },

        sentOfKind<K extends ClusterRequest["kind"]>(kind: K): Extract<ClusterRequest, { kind: K }>[] {
            return fx.router.sent
                .map((entry) => entry.req)
                .filter((req): req is Extract<ClusterRequest, { kind: K }> => req.kind === kind);
        },

        async start(options: StartOptions): Promise<void> {
            fx.gateway = new PluginGateway({
                resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }),
                router: fx.router,
                linking: fx.linking,
                ...options,
            });
            fx.server = createServer();
            fx.gateway.attach(fx.server);
            await new Promise<void>((resolve) => fx.server.listen(0, "127.0.0.1", resolve));
            fx.url = `ws://127.0.0.1:${(fx.server.address() as AddressInfo).port}/ws`;
        },

        async restart(options: StartOptions): Promise<void> {
            await fx.gateway.close();
            await new Promise<void>((resolve) => fx.server.close(() => resolve()));
            await fx.start(options);
        },
    } as PluginGatewayFixture;

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        fx.router = new InMemoryClusterRouter();
        fx.router.register(GUILD, async () => ({ ok: true }));
        fx.db = await createTestDatabase();
        fx.linking = new LinkingService(fx.db);
        await fx.start({ helloTimeoutMs: 100 });
    });

    afterEach(async () => {
        for (const ws of fx.clients.splice(0)) ws.terminate();
        await fx.gateway.close();
        fx.server.closeAllConnections();
        await new Promise<void>((resolve) => fx.server.close(() => resolve()));
        await fx.db.close();
        vi.restoreAllMocks();
    });

    return fx;
}
