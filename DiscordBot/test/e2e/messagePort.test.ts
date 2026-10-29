import { restError } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiscordClient } from "../../src/Cluster/createDiscordClient";
import { classifyDiscordError, createDiscordMessagePort } from "../../src/Cluster/messagePort";
import { createTestProbe } from "../helpers/probe";

const CHANNEL = "1400000000000000001";
const MESSAGE = "1500000000000000001";
const IS_COMPONENTS_V2 = 1 << 15;

describe("createDiscordMessagePort", () => {
    let probe: ReturnType<typeof createTestProbe>;
    let client: ReturnType<typeof createDiscordClient>;

    beforeEach(async () => {
        client = createDiscordClient();
        probe = createTestProbe(client);
        await probe.setup();
    });

    afterEach(async () => {
        await probe.teardown();
    });

    const payload = { components: [{ type: 17, components: [{ type: 10, content: "hello" }] }] };

    it("posts a components v2 message without allowed mentions", async () => {
        const id = await createDiscordMessagePort(client).post(CHANNEL, payload);

        const request = probe.capturedRequests().find((r) => r.method === "POST");
        expect(request?.url).toContain(`/channels/${CHANNEL}/messages`);
        const body = request?.body as { flags: number; allowed_mentions: { parse: string[] }; components: unknown[] };
        expect(body.allowed_mentions.parse).toEqual([]);
        expect(body.flags & IS_COMPONENTS_V2).toBe(IS_COMPONENTS_V2);
        expect(body.components).toEqual(payload.components);
        expect(typeof id).toBe("string");
    });

    it("edits and deletes a message by id", async () => {
        const port = createDiscordMessagePort(client);

        await port.edit(CHANNEL, MESSAGE, payload);
        await port.delete(CHANNEL, MESSAGE);

        const requests = probe.capturedRequests();
        expect(
            requests.some((r) => r.method === "PATCH" && r.url.endsWith(`/channels/${CHANNEL}/messages/${MESSAGE}`)),
        ).toBe(true);
        expect(
            requests.some((r) => r.method === "DELETE" && r.url.endsWith(`/channels/${CHANNEL}/messages/${MESSAGE}`)),
        ).toBe(true);
    });

    it.each([
        [403, 50001, "missing-access"],
        [403, 50013, "missing-access"],
        [404, 10003, "unknown-channel"],
        [404, 10008, "unknown-message"],
        [400, 50035, "other"],
    ])("classifies status %i code %i as %s", async (status, code, expected) => {
        probe.respond("POST", /\/channels\/\d+\/messages$/, () => restError(status, { code, message: "x" }));

        const error = await createDiscordMessagePort(client)
            .post(CHANNEL, payload)
            .catch((e: unknown) => e);

        expect(classifyDiscordError(error)).toBe(expected);
    });

    it("classifies anything else as other", () => {
        expect(classifyDiscordError(new Error("boom"))).toBe("other");
    });
});
