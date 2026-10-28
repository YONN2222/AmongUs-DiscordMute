import { extractText, restError } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscordClient } from "../../src/Cluster/createDiscordClient";
import { updateOriginalLinkReply } from "../../src/Cluster/linkReply";
import { logger } from "../../src/Logging/logger";
import { createTestProbe } from "../helpers/probe";

const ORIGINAL = /\/webhooks\/app-1\/token-1\/messages\/(@|%40)original$/;

describe("updateOriginalLinkReply", () => {
    let probe: ReturnType<typeof createTestProbe>;
    let client: ReturnType<typeof createDiscordClient>;

    beforeEach(async () => {
        for (const level of ["warn", "error"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        client = createDiscordClient();
        probe = createTestProbe(client);
        await probe.setup();
    });

    afterEach(async () => {
        await probe.teardown();
        vi.restoreAllMocks();
    });

    const link = {
        guildId: "g",
        discordId: "1300000000000000001",
        accountName: "Red",
        applicationId: "app-1",
        interactionToken: "token-1",
    };

    it("edits the original /link reply through the interaction webhook", async () => {
        expect(await updateOriginalLinkReply(client.rest, link)).toBe(true);

        expect(probe.lastReply()).toBeDefined();
        expect(extractText(probe.lastReply() ?? {})).toContain("Red");
        expect(probe.capturedRequests().some((r) => r.method === "PATCH" && ORIGINAL.test(r.url))).toBe(true);
    });

    it("reports false when the webhook data is missing or Discord refuses", async () => {
        expect(await updateOriginalLinkReply(client.rest, { ...link, interactionToken: undefined })).toBe(false);

        probe.respond("PATCH", ORIGINAL, () => restError(404, { code: 10015, message: "Unknown Webhook" }));
        expect(await updateOriginalLinkReply(client.rest, link)).toBe(false);
        expect(logger.error).toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("token-1");
        expect(vi.mocked(logger.error).mock.calls[0].join(" ")).toContain("10015");
    });
});
