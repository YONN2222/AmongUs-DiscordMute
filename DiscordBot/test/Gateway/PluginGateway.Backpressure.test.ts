import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { GUILD, gameEvent, hello, sleep, usePluginGatewayFixture, waitForClose } from "../Helpers/PluginGatewayFixture";

describe("PluginGateway", () => {
    const fx = usePluginGatewayFixture();

    describe("backpressure", () => {
        it("closes 4003 when flooded before the session is active", async () => {
            await fx.restart({
                resolver: {
                    resolve: async () => {
                        await sleep(50);
                        return { guildId: GUILD };
                    },
                },
            });
            const ws = await fx.connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            for (let i = 0; i < 30; i++) ws.send(gameEvent(`flood-${i}`));

            expect((await closed).code).toBe(4003);
            await sleep(80);
            expect(fx.sentOfKind("game-event")).toHaveLength(0);
            expect(fx.gateway.sessionCount()).toBe(0);
        });

        it("accepts a burst up to the limit before the session is active", async () => {
            await fx.restart({
                resolver: {
                    resolve: async () => {
                        await sleep(50);
                        return { guildId: GUILD };
                    },
                },
            });
            const ws = await fx.connect();
            ws.send(hello());
            for (let i = 0; i < 15; i++) ws.send(gameEvent(`burst-${i}`));

            await vi.waitFor(() => expect(fx.sentOfKind("game-event")).toHaveLength(15));
            expect(ws.readyState).toBe(WebSocket.OPEN);
        });

        it("closes 4003 when flooded after auth while the router is slow", async () => {
            await fx.restart({ routeTimeoutMs: 200 });
            fx.router.register(GUILD, async (req) => {
                if (req.kind === "game-event") await sleep(1000);
                return { ok: true };
            });
            const ws = await fx.authenticate();
            const closed = waitForClose(ws);
            for (let i = 0; i < 100; i++) ws.send(gameEvent(`flood-${i}`));

            expect((await closed).code).toBe(4003);
            expect(fx.sentOfKind("game-event").length).toBeLessThanOrEqual(1);
        });
    });
});
