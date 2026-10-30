import { Database } from "bun:sqlite";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_API_PREFIX } from "../src/Admin/Contract";
import { type Config, parseConfig } from "../src/Config/ConfigSchema";
import { type GatewayDeps, type GatewayInstance, type RunningGateway, runGateway } from "../src/Gateway/RunGateway";
import { logger } from "../src/Logging/Logger";
import { EXIT_CONFIG } from "../src/Process/ExitCodes";
import { postgresUrl } from "./Helpers/TestDatabase";

const TEST_ADMIN_TOKEN = "x".repeat(40);

it("runs under the Bun runtime with bun:sqlite available", () => {
    const db = new Database(":memory:");
    const row = db.query("SELECT 1 AS value").get() as { value: number };
    expect(row.value).toBe(1);
    db.close();
});

function exampleConfig(overrides: Record<string, unknown> = {}): Config {
    const raw = JSON.parse(readFileSync(join(__dirname, "../config.example.json"), "utf8"));
    const parsed = parseConfig({ ...raw, ...overrides });
    // Port 0 picks a free port; the gateway must not touch the network or the real database in a test.
    return { ...parsed, botIp: "127.0.0.1", botPort: 0, sqlitePath: ":memory:", disableUpdateCheck: true };
}

function fakeInstance(): GatewayInstance {
    const instance = Object.assign(new EventEmitter(), {
        clusters: new Map(),
        start: () => {},
        stopRespawning: () => {},
        shutdown: async () => {},
        sendRequestToCluster: async () => ({}),
        sendRequestToClusterOfGuild: async () => ({ ok: false, error: "no cluster" }),
    });
    return instance as unknown as GatewayInstance;
}

function testDeps(env: Record<string, string | undefined>) {
    return {
        env,
        exit: vi.fn<(code: number) => void>(),
        createInstance: vi.fn<GatewayDeps["createInstance"]>(() => fakeInstance()),
        onShutdownSignal: () => {},
    } satisfies GatewayDeps;
}

function isListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => resolve(false));
    });
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
        });
    });
}

describe("gateway wiring", () => {
    let running: RunningGateway | undefined;

    afterEach(async () => {
        await running?.shutdown(0);
        running = undefined;
        vi.restoreAllMocks();
    });

    it("self-host gateway does not open the admin port", async () => {
        const deps = testDeps({ ADMIN_API_TOKEN: TEST_ADMIN_TOKEN });
        running = await runGateway(exampleConfig(), deps);

        expect(running).toBeDefined();
        expect(deps.exit).not.toHaveBeenCalled();
        expect(await isListening(exampleConfig().adminApi.port)).toBe(false);
    });

    it("hosted start without ADMIN_API_TOKEN exits with the message", async () => {
        const error = vi.spyOn(logger, "error");
        const deps = testDeps({});

        running = await runGateway(exampleConfig({ mode: "hosted" }), deps);

        expect(running).toBeUndefined();
        expect(deps.exit).toHaveBeenCalledWith(EXIT_CONFIG);
        expect(deps.createInstance).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(
            expect.anything(),
            "ADMIN_API_TOKEN must be set to at least 32 characters in hosted mode",
        );
    });

    it("hosted start on sqlite exits with the database message", async () => {
        const error = vi.spyOn(logger, "error");
        const deps = testDeps({ ADMIN_API_TOKEN: TEST_ADMIN_TOKEN });

        running = await runGateway(exampleConfig({ mode: "hosted" }), deps);

        expect(running).toBeUndefined();
        expect(deps.exit).toHaveBeenCalledWith(EXIT_CONFIG);
        expect(error).toHaveBeenCalledWith(
            expect.anything(),
            'databaseDialect must be "postgres" (with databaseUrl) in hosted mode',
        );
    });

    it.skipIf(postgresUrl === undefined)("hosted gateway serves the admin API on adminApi host and port", async () => {
        const port = await freePort();
        const deps = testDeps({ ADMIN_API_TOKEN: TEST_ADMIN_TOKEN });
        const config = exampleConfig({
            mode: "hosted",
            databaseDialect: "postgres",
            databaseUrl: postgresUrl,
            disableTelemetry: true,
            adminApi: { host: "127.0.0.1", port },
        });

        running = await runGateway(config, deps);
        const response = await fetch(`http://127.0.0.1:${port}${ADMIN_API_PREFIX}/health`, {
            headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, data: { status: "ok", mode: "hosted" } });
        await running?.shutdown(0);
        running = undefined;
        expect(await isListening(port)).toBe(false);
        expect(deps.exit).toHaveBeenCalledWith(0);
    });
});
