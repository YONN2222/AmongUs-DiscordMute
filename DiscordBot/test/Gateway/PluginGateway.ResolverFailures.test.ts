import { describe, expect, it } from "vitest";
import { hello, usePluginGatewayFixture, waitForClose } from "../Helpers/PluginGatewayFixture";

describe("PluginGateway", () => {
    const fx = usePluginGatewayFixture();

    describe("resolver failures", () => {
        it("closes 4001 when the resolver throws synchronously", async () => {
            await fx.restart({
                resolver: {
                    resolve: () => {
                        throw new Error("boom");
                    },
                },
            });
            const ws = await fx.connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            expect((await closed).code).toBe(4001);
        });

        it("closes 4001 when the resolver rejects", async () => {
            await fx.restart({ resolver: { resolve: async () => Promise.reject(new Error("db down")) } });
            const ws = await fx.connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            expect((await closed).code).toBe(4001);
        });

        it("closes 4000 when the resolver never answers", async () => {
            await fx.restart({ helloTimeoutMs: 50, resolver: { resolve: () => new Promise(() => {}) } });
            const ws = await fx.connect();
            const closed = waitForClose(ws);
            ws.send(hello());
            expect((await closed).code).toBe(4000);
            expect(fx.gateway.sessionCount()).toBe(0);
        });
    });
});
