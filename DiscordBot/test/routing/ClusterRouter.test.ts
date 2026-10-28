import { describe, expect, it } from "vitest";
import {
    GalacticClusterRouter,
    GalacticGatewayLink,
    InMemoryClusterRouter,
    InMemoryGatewayLink,
} from "../../src/Routing/ClusterRouter";
import { type ClusterRequest, type GatewayRequest, toRouterReply } from "../../src/Routing/messages";

const req: ClusterRequest = { kind: "session-ended", guildId: "g", sessionId: "s" };

describe("GalacticClusterRouter", () => {
    it("maps a rejection to ok:false", async () => {
        const router = new GalacticClusterRouter({
            sendRequestToClusterOfGuild: () => Promise.reject(new Error("timeout")),
        });
        expect(await router.send("g", req)).toEqual({ ok: false, error: "timeout" });
    });

    it("forwards with a 10s timeout and validates the reply", async () => {
        const calls: unknown[][] = [];
        const router = new GalacticClusterRouter({
            sendRequestToClusterOfGuild: async (...args) => {
                calls.push(args);
                return { ok: true, notice: { code: "host-not-linked", message: "m" } };
            },
        });
        const reply = await router.send("g", req);
        expect(calls).toEqual([["g", req, 10000]]);
        expect(reply).toEqual({
            ok: true,
            notice: { code: "host-not-linked", message: "m" },
        });
    });

    it("treats a malformed reply as invalid", async () => {
        const router = new GalacticClusterRouter({
            sendRequestToClusterOfGuild: async () => ({ nope: 1 }),
        });
        expect(await router.send("g", req)).toEqual({
            ok: false,
            error: "invalid reply",
        });
    });
});

describe("GalacticGatewayLink", () => {
    it("forwards and maps failures", async () => {
        const ok = new GalacticGatewayLink({ sendRequest: async () => ({ ok: true }) });
        expect(await ok.send({ kind: "is-plugin-connected", guildId: "g" })).toEqual({
            ok: true,
        });
        const bad = new GalacticGatewayLink({
            sendRequest: () => Promise.reject(new Error("boom")),
        });
        expect(await bad.send({ kind: "is-plugin-connected", guildId: "g" })).toEqual({
            ok: false,
            error: "boom",
        });
    });
});

describe("toRouterReply", () => {
    it.each([
        ["null", null],
        ["bad notice code", { ok: true, notice: { code: "bad", message: "m" } }],
        ["ok:false without error", { ok: false }],
        ["string", "ok"],
    ])("treats %s as invalid", (_name, value) => {
        expect(toRouterReply(value)).toEqual({ ok: false, error: "invalid reply" });
    });

    it("accepts a plain ok reply", () => {
        expect(toRouterReply({ ok: true })).toEqual({ ok: true });
    });
});

describe("GalacticGatewayLink malformed reply", () => {
    it("maps a malformed reply to invalid", async () => {
        const link = new GalacticGatewayLink({ sendRequest: async () => ({ ok: "yes" }) });
        expect(await link.send({ kind: "is-plugin-connected", guildId: "g" })).toEqual({
            ok: false,
            error: "invalid reply",
        });
    });
});

describe("in-memory routing", () => {
    const gatewayReq: GatewayRequest = { kind: "is-plugin-connected", guildId: "g" };

    it("routes cluster requests to the registered handler and logs them", async () => {
        const router = new InMemoryClusterRouter();
        router.register("g", async () => ({ ok: true }));
        expect(await router.send("g", req)).toEqual({ ok: true });
        expect(await router.send("other", req)).toEqual({ ok: false, error: "no handler" });
        expect(router.sent).toEqual([
            { guildId: "g", req },
            { guildId: "other", req },
        ]);
    });

    it("routes gateway requests to the registered handler and logs them", async () => {
        const link = new InMemoryGatewayLink();
        link.register("g", async () => ({ ok: true }));
        expect(await link.send(gatewayReq)).toEqual({ ok: true });
        expect(await link.send({ kind: "is-plugin-connected", guildId: "other" })).toEqual({
            ok: false,
            error: "no handler",
        });
        expect(link.sent).toHaveLength(2);
    });

    it("keeps cluster and gateway handlers for the same guild independent", async () => {
        const router = new InMemoryClusterRouter();
        const link = new InMemoryGatewayLink();
        router.register("g", async () => ({ ok: false, error: "cluster" }));
        link.register("g", async () => ({ ok: false, error: "gateway" }));
        expect(await router.send("g", req)).toEqual({ ok: false, error: "cluster" });
        expect(await link.send(gatewayReq)).toEqual({ ok: false, error: "gateway" });
    });
});
