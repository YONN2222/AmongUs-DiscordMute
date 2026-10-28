import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, Events, GatewayCloseCodes, GatewayIntentBits } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { createDiscordClient, DISCORD_INTENTS } from "../../src/Cluster/createDiscordClient";
import { fatalGatewayCloseMessage, onFatalGatewayClose } from "../../src/Cluster/fatalGatewayClose";

const MEMBERS_INTENT_MESSAGE = "Enable the Server Members intent for the bot in the Discord developer portal";

describe("fatalGatewayCloseMessage", () => {
    it("explains the codes discord.js does not recover from", () => {
        expect(fatalGatewayCloseMessage(4014)).toBe(MEMBERS_INTENT_MESSAGE);
        for (const code of [4004, 4010, 4011, 4013]) {
            expect(fatalGatewayCloseMessage(code)).toEqual(expect.any(String));
        }
    });

    it("leaves recoverable and normal closes alone", () => {
        for (const code of [1000, 1006, 4000, 4007, 4008, 4009, GatewayCloseCodes.UnknownError]) {
            expect(fatalGatewayCloseMessage(code)).toBeNull();
        }
    });
});

describe("onFatalGatewayClose", () => {
    const client = createDiscordClient();

    afterEach(() => {
        client.removeAllListeners();
    });

    it("reports a fatal shard disconnect with its shard id", () => {
        const handler = vi.fn();
        onFatalGatewayClose(client, handler);
        client.emit(Events.ShardDisconnect, new CloseEvent("close", { code: 4014 }), 2);
        expect(handler).toHaveBeenCalledWith(MEMBERS_INTENT_MESSAGE, 2);
    });

    it("ignores other disconnects", () => {
        const handler = vi.fn();
        onFatalGatewayClose(client, handler);
        client.emit(Events.ShardDisconnect, new CloseEvent("close", { code: 1000 }), 0);
        expect(handler).not.toHaveBeenCalled();
    });
});

/** Answers GET /gateway/bot and closes every identify with the given gateway close code. */
async function startRefusingGateway(closeCode: number): Promise<{ server: Server; api: string }> {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    server.on("request", (req, res) => {
        if (!req.url?.endsWith("/gateway/bot")) {
            res.writeHead(404).end();
            return;
        }
        const { port } = server.address() as AddressInfo;
        res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
                url: `ws://127.0.0.1:${port}`,
                shards: 1,
                session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
            }),
        );
    });
    wss.on("connection", (ws) => {
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
        ws.on("message", (data) => {
            if ((JSON.parse(data.toString()) as { op: number }).op === 2) ws.close(closeCode);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, api: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` };
}

describe("discord.js behaviour on disallowed intents", () => {
    it("rejects login without a code and reports 4014 through shardDisconnect", async () => {
        const { server, api } = await startRefusingGateway(GatewayCloseCodes.DisallowedIntents);
        const client = new Client({
            intents: DISCORD_INTENTS.map((intent) => GatewayIntentBits[intent]),
            rest: { api },
        });
        const handler = vi.fn();
        onFatalGatewayClose(client, handler);
        try {
            const error = await client.login("a.fake.token").then(
                () => null,
                (err: unknown) => err,
            );
            expect(error).toBeInstanceOf(Error);
            expect(error).not.toHaveProperty("code");
            expect(handler).toHaveBeenCalledWith(MEMBERS_INTENT_MESSAGE, 0);
        } finally {
            await client.destroy();
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }, 20_000);
});
