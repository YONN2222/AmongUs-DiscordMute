import { extractText, restError } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscordClient } from "../../src/Cluster/CreateDiscordClient";
import { resolveLinkReplyLocale, updateOriginalLinkReply } from "../../src/Cluster/LinkReply";
import { type Locale, t } from "../../src/I18n/Index";
import { logger } from "../../src/Logging/Logger";
import { createTestProbe } from "../Helpers/Probe";

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
        expect(await updateOriginalLinkReply(client.rest, link, "en")).toBe(true);

        expect(probe.lastReply()).toBeDefined();
        expect(extractText(probe.lastReply() ?? {})).toContain("Red");
        expect(extractText(probe.lastReply() ?? {})).toContain(t("en", "link.complete.title"));
        expect(probe.capturedRequests().some((r) => r.method === "PATCH" && ORIGINAL.test(r.url))).toBe(true);
    });

    describe("resolveLinkReplyLocale", () => {
        const guildLanguage = (language: Locale) => vi.fn(async () => language);

        it("prefers the locale of the interaction", async () => {
            const lookup = guildLanguage("en");
            expect(await resolveLinkReplyLocale({ ...link, locale: "de" }, lookup)).toBe("de");
            expect(lookup).not.toHaveBeenCalled();
        });

        it("falls back to the guild language", async () => {
            expect(await resolveLinkReplyLocale(link, guildLanguage("de"))).toBe("de");
        });

        it("falls back to english and logs when the guild lookup fails", async () => {
            const failing = vi.fn(async () => {
                throw new Error("db down");
            });
            expect(await resolveLinkReplyLocale(link, failing)).toBe("en");
            expect(logger.error).toHaveBeenCalled();
        });
    });

    it("writes the reply in the given language", async () => {
        expect(await updateOriginalLinkReply(client.rest, link, "de")).toBe(true);

        expect(extractText(probe.lastReply() ?? {})).toContain(t("de", "link.complete.title"));
    });

    it("reports false when the webhook data is missing or Discord refuses", async () => {
        expect(await updateOriginalLinkReply(client.rest, { ...link, interactionToken: undefined }, "en")).toBe(false);

        probe.respond("PATCH", ORIGINAL, () => restError(404, { code: 10015, message: "Unknown Webhook" }));
        expect(await updateOriginalLinkReply(client.rest, link, "en")).toBe(false);
        expect(logger.error).toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("token-1");
        expect(vi.mocked(logger.error).mock.calls[0].join(" ")).toContain("10015");
    });
});
