import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { DeviceTokenResolver } from "../../src/Gateway/DeviceTokenResolver";
import { MAX_PAIRING_ATTEMPTS, PAIR_START_LIMIT } from "../../src/Gateway/PluginGateway";
import { CLOSE_INVALID_MESSAGE, CLOSE_PAIRING_FAILED, PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import {
    GUILD,
    gameEvent,
    hello,
    nextMessage,
    usePluginGatewayFixture,
    waitForClose,
} from "../Helpers/PluginGatewayFixture";

const NORMAL_CLOSE = 1000;

function pairStart(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        type: "pair-start",
        protocolVersion: PROTOCOL_VERSION,
        pluginVersion: "3.1.0",
        gameVersion: "2026.4.23",
        platform: "android",
        ...overrides,
    });
}

const pairChat = (code: string) => JSON.stringify({ type: "pair-chat", code });

describe("PluginGateway pairing", () => {
    const fx = usePluginGatewayFixture();

    async function startPairing(options?: Parameters<typeof fx.connect>[0]): Promise<WebSocket> {
        const ws = await fx.connect(options);
        ws.send(pairStart());
        return ws;
    }

    async function issueCode(): Promise<string> {
        await fx.db.pairingCodes.replace({
            guildId: GUILD,
            guildName: "Crew Lounge",
            code: "79-80-2600",
            expiresAt: Date.now() + 60_000,
        });
        return "79-80-2600";
    }

    it("hands out a device token for the right code, then closes; the token opens a normal session", async () => {
        const code = await issueCode();
        const ws = await startPairing();
        const paired = nextMessage(ws);
        const closed = waitForClose(ws);
        ws.send(pairChat(code));

        const message = await paired;
        expect(message).toEqual({ type: "paired", secret: expect.stringMatching(/^dmh_/), guildName: "Crew Lounge" });
        expect((await closed).code).toBe(NORMAL_CLOSE);
        expect((await fx.db.deviceTokens.list(GUILD, 10))[0]?.platform).toBe("android");

        await fx.restart({ resolver: new DeviceTokenResolver(fx.db.deviceTokens) });
        const device = await fx.connect();
        const welcome = nextMessage(device);
        device.send(hello({ secret: message.secret, platform: "android" }));
        expect(await welcome).toMatchObject({ type: "welcome" });
        expect(fx.gateway.sessionsInfo(GUILD)).toEqual([expect.objectContaining({ platform: "android" })]);
    });

    it("answers a wrong code with the attempts left and closes after the last one", async () => {
        await issueCode();
        const ws = await startPairing();
        const closed = waitForClose(ws);

        for (let attempt = 1; attempt <= MAX_PAIRING_ATTEMPTS; attempt++) {
            const result = nextMessage(ws);
            ws.send(pairChat("1-2-3"));
            expect(await result).toEqual({
                type: "pair-result",
                ok: false,
                attemptsLeft: MAX_PAIRING_ATTEMPTS - attempt,
            });
        }

        expect(await closed).toEqual({ code: CLOSE_PAIRING_FAILED, reason: "Too many pairing attempts" });
        expect(await fx.db.deviceTokens.list(GUILD, 10)).toEqual([]);
    });

    it("closes a pairing connection that waited too long", async () => {
        await fx.restart({ pairingTimeoutMs: 100 });
        const ws = await startPairing();

        expect(await waitForClose(ws)).toEqual({ code: CLOSE_PAIRING_FAILED, reason: "Pairing timeout" });
    });

    it("routes no game events while pairing", async () => {
        const ws = await startPairing();
        const closed = waitForClose(ws);
        ws.send(gameEvent());

        expect(await closed).toEqual({ code: CLOSE_INVALID_MESSAGE, reason: "Expected pair-chat" });
        expect(fx.router.sent).toEqual([]);
    });

    it("refuses pairing messages on an authenticated connection", async () => {
        const ws = await fx.authenticate();
        const closed = waitForClose(ws);
        ws.send(pairChat("1-2-3"));

        expect((await closed).code).toBe(CLOSE_INVALID_MESSAGE);
    });

    it("limits pair-start per client address, read from the configured header", async () => {
        await fx.restart({ clientIpHeader: "cf-connecting-ip" });
        const from = (ip: string) => ({ headers: { "cf-connecting-ip": ip } });

        for (let i = 0; i < PAIR_START_LIMIT; i++) await startPairing(from("203.0.113.1"));
        const refused = await startPairing(from("203.0.113.1"));
        expect(await waitForClose(refused)).toEqual({
            code: CLOSE_PAIRING_FAILED,
            reason: "Too many pairing attempts",
        });

        const other = await startPairing(from("203.0.113.2"));
        const result = nextMessage(other);
        other.send(pairChat("1-2-3"));
        expect(await result).toMatchObject({ type: "pair-result", ok: false });
    });

    it("closes the connection when pairing fails on the bot side", async () => {
        vi.spyOn(fx.db.pairingCodes, "consume").mockRejectedValue(new Error("db down"));
        const ws = await startPairing();
        const closed = waitForClose(ws);
        ws.send(pairChat("1-2-3"));

        expect((await closed).code).toBe(CLOSE_PAIRING_FAILED);
    });

    it("drops an unknown hello platform instead of refusing the plugin", async () => {
        const ws = await fx.connect();
        const welcome = nextMessage(ws);
        ws.send(hello({ platform: "ios" }));

        expect(await welcome).toMatchObject({ type: "welcome" });
        expect(fx.gateway.sessionsInfo(GUILD)[0]).not.toHaveProperty("platform");
    });
});
