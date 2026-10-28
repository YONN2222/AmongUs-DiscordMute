import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { PluginGateway } from "../../src/Gateway/PluginGateway";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { createClusterExitHandler, shutdownGateway } from "../../src/Gateway/shutdown";
import { logger } from "../../src/Logging/logger";
import { CLUSTER_EXIT_LOGIN_FAILED } from "../../src/Process/processRole";
import { PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import type { LinkingService } from "../../src/Utils/LinkingService";

const GUILD = "guild-1";
const SECRET = "secret";

beforeEach(() => {
    for (const level of ["info", "warn", "error", "debug", "success"] as const) {
        vi.spyOn(logger, level).mockImplementation(() => {});
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("shutdownGateway", () => {
    it("ends plugin sessions on the clusters before stopping them, then closes http and the database", async () => {
        const order: string[] = [];
        const router = new InMemoryClusterRouter();
        router.register(GUILD, async (req) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push(`cluster applied ${req.kind}`);
            return { ok: true };
        });
        const gateway = new PluginGateway({
            resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }),
            router,
            linking: {} as LinkingService,
        });
        const server = createServer();
        gateway.attach(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`);
        await new Promise((resolve) => ws.once("open", resolve));
        const welcome = new Promise((resolve) => ws.once("message", resolve));
        ws.send(
            JSON.stringify({
                type: "hello",
                protocolVersion: PROTOCOL_VERSION,
                secret: SECRET,
                pluginVersion: "2.0.0",
                gameVersion: "1",
            }),
        );
        await welcome;

        await shutdownGateway({
            closePluginSessions: () => gateway.close(),
            stopClusters: async () => {
                order.push("clusters stopped");
            },
            closeHttpServer: async () => {
                order.push("http closed");
                await new Promise<void>((resolve) => server.close(() => resolve()));
            },
            closeDatabase: async () => {
                order.push("database closed");
            },
        });

        expect(order).toEqual(["cluster applied session-ended", "clusters stopped", "http closed", "database closed"]);
    });

    it("keeps going when a step fails", async () => {
        const closeDatabase = vi.fn(async () => {});
        await shutdownGateway({
            closePluginSessions: async () => {
                throw new Error("boom");
            },
            stopClusters: async () => {},
            closeHttpServer: async () => {},
            closeDatabase,
        });
        expect(closeDatabase).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalled();
    });
});

describe("createClusterExitHandler", () => {
    function setup() {
        const calls: string[] = [];
        const onExit = createClusterExitHandler({
            stopRespawning: () => calls.push("stop respawning"),
            shutdown: (code) => calls.push(`shutdown ${code}`),
        });
        return { calls, onExit };
    }

    it("stops respawning, then shuts down ordered with exit code 1 after an invalid token", () => {
        const { calls, onExit } = setup();
        onExit(0, CLUSTER_EXIT_LOGIN_FAILED);
        expect(calls).toEqual(["stop respawning", "shutdown 1"]);
    });

    it("leaves respawning to galactic for other exits", () => {
        const { calls, onExit } = setup();
        onExit(0, 1);
        onExit(0, 0);
        onExit(0, null);
        expect(calls).toEqual([]);
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });
});
