import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import { type Locale, t } from "../../src/I18n/Index";
import { logger, logModules } from "../../src/Logging/Logger";
import { createVoiceTargetResolver } from "../../src/Mute/VoiceTargetResolver";
import { createTestDatabase, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe("VoiceTargetResolver", () => {
    let db: Database;
    let guildId: string;

    beforeEach(async () => {
        db = await createTestDatabase();
        guildId = uniqueId("g");
    });

    afterEach(async () => {
        await purgeTestRows(db);
        await db.close();
    });

    function resolver(channelOf: string | null, fallbackChannelIds: string[] = [], locale: Locale = "en") {
        const memberVoiceChannel = vi.fn(async () => channelOf);
        const resolve = createVoiceTargetResolver({
            links: db.links,
            memberVoiceChannel,
            fallbackChannelIds,
            localeOf: async () => locale,
        });
        return { resolve, memberVoiceChannel };
    }

    it("uses the host's current channel", async () => {
        await db.links.upsert(guildId, "u1", "Crew");
        const { resolve, memberVoiceChannel } = resolver("vc-1", ["fallback"]);
        expect(await resolve(guildId, "crew")).toEqual({ channelIds: ["vc-1"] });
        expect(memberVoiceChannel).toHaveBeenCalledWith(guildId, "u1");
    });

    it("falls back to configured channels", async () => {
        const { resolve } = resolver(null, ["c1", "c2"]);
        expect(await resolve(guildId, "Nobody")).toEqual({ channelIds: ["c1", "c2"] });
        await db.links.upsert(guildId, "u1", "Crew");
        expect(await resolve(guildId, "Crew")).toEqual({ channelIds: ["c1", "c2"] });
    });

    it("returns a host-not-linked notice", async () => {
        const { resolve } = resolver("vc-1");
        expect(await resolve(guildId, "Nobody")).toEqual({
            notice: { code: "host-not-linked", message: t("en", "notice.hostNotLinked") },
        });
    });

    it("words the notices in the language of the server", async () => {
        const { resolve } = resolver(null, [], "de");
        expect(await resolve(guildId, "Nobody")).toEqual({
            notice: { code: "host-not-linked", message: t("de", "notice.hostNotLinked") },
        });
        await db.links.upsert(guildId, "u1", "Crew");
        expect(await resolve(guildId, "Crew")).toEqual({
            notice: { code: "host-not-in-voice", message: t("de", "notice.hostNotInVoice") },
        });
    });

    it("words the notice in english and logs when the language lookup fails", async () => {
        const error = new Error("db down");
        const log = vi.spyOn(logger, "error").mockImplementation(() => {});
        const resolve = createVoiceTargetResolver({
            links: db.links,
            memberVoiceChannel: async () => null,
            fallbackChannelIds: [],
            localeOf: async () => {
                throw error;
            },
        });
        expect(await resolve(guildId, "Nobody")).toEqual({
            notice: { code: "host-not-linked", message: t("en", "notice.hostNotLinked") },
        });
        expect(log).toHaveBeenCalledWith(logModules.Mute, expect.stringContaining(guildId), error);
        log.mockRestore();
    });

    it("returns a host-not-in-voice notice", async () => {
        await db.links.upsert(guildId, "u1", "Crew");
        const { resolve } = resolver(null);
        expect(await resolve(guildId, "Crew")).toEqual({
            notice: {
                code: "host-not-in-voice",
                message: t("en", "notice.hostNotInVoice"),
            },
        });
    });

    describe("when the voice lookup fails", () => {
        const failing = (fallbackChannelIds: string[]) => {
            const error = new Error("discord down");
            const log = vi.spyOn(logger, "error").mockImplementation(() => {});
            const resolve = createVoiceTargetResolver({
                links: db.links,
                memberVoiceChannel: async () => {
                    throw error;
                },
                fallbackChannelIds,
                localeOf: async () => "en",
            });
            return { resolve, log, error };
        };

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("returns the host-not-in-voice notice and logs the error", async () => {
            await db.links.upsert(guildId, "u1", "Crew");
            const { resolve, log, error } = failing([]);
            expect(await resolve(guildId, "Crew")).toMatchObject({ notice: { code: "host-not-in-voice" } });
            expect(log).toHaveBeenCalledWith(logModules.Mute, expect.stringContaining(guildId), error);
            expect(log.mock.calls[0][1]).toContain("u1");
        });

        it("uses the configured channels", async () => {
            await db.links.upsert(guildId, "u1", "Crew");
            const { resolve } = failing(["c1"]);
            expect(await resolve(guildId, "Crew")).toEqual({ channelIds: ["c1"] });
        });
    });

    it("uses the configured channels for an ambiguous host name", async () => {
        await db.links.upsert(guildId, "u1", "Red");
        await db.links.upsert(guildId, "u2", "Clan | red");
        const { resolve } = resolver("vc-1", ["c1"]);
        expect(await resolve(guildId, "red")).toEqual({ channelIds: ["c1"] });
    });

    it("treats an ambiguous host name as not linked", async () => {
        await db.links.upsert(guildId, "u1", "Red");
        await db.links.upsert(guildId, "u2", "Clan | red");
        const { resolve, memberVoiceChannel } = resolver("vc-1");
        expect(await resolve(guildId, "RED")).toMatchObject({ notice: { code: "host-not-linked" } });
        expect(memberVoiceChannel).not.toHaveBeenCalled();
    });
});
