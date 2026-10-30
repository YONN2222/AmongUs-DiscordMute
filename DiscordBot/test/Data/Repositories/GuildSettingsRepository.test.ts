import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../../src/Data/Database";
import type { GuildSettingsModel } from "../../../src/Data/Models/GuildSettingsModel";
import { createGuildSettingsRepository } from "../../../src/Data/Repositories/GuildSettingsRepository";
import { DEFAULT_SETTINGS, mergeSettings } from "../../../src/Settings/GuildSettings";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../../Helpers/TestDatabase";

describe("createGuildSettingsRepository", () => {
    it("refuses a model that was never initialised", () => {
        expect(() => createGuildSettingsRepository({} as typeof GuildSettingsModel)).toThrow(/not initialised/);
    });
});

describe.each(backends)("GuildSettingsRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("g");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("returns the defaults for an unknown guild", async () => {
            expect(await db.settings.get(guildId)).toEqual(DEFAULT_SETTINGS);
        });

        it("round-trips saved settings", async () => {
            const settings = mergeSettings(DEFAULT_SETTINGS, {
                language: "de",
                logChannelId: "123456789012345678",
                voiceRules: { meeting: { dead: "deafen" } },
            });
            await db.settings.save(guildId, settings);
            expect(await db.settings.get(guildId)).toEqual(settings);
        });

        it("overwrites the previous row on save", async () => {
            await db.settings.save(guildId, mergeSettings(DEFAULT_SETTINGS, { ghostChat: true }));
            await db.settings.save(guildId, mergeSettings(DEFAULT_SETTINGS, { autoRelink: false }));
            const stored = await db.settings.get(guildId);
            expect(stored.ghostChat).toBe(false);
            expect(stored.autoRelink).toBe(false);
        });

        it("reads a partial row as the stored fields plus defaults", async () => {
            await db.sequelize.query("INSERT INTO guild_settings (guild_id, data) VALUES (:guildId, :data)", {
                replacements: { guildId, data: '{"language":"de","bogus":1}' },
            });
            expect(await db.settings.get(guildId)).toEqual({ ...DEFAULT_SETTINGS, language: "de" });
        });

        it("reads a corrupt row as the defaults", async () => {
            await db.sequelize.query("INSERT INTO guild_settings (guild_id, data) VALUES (:guildId, :data)", {
                replacements: { guildId, data: "{not json" },
            });
            expect(await db.settings.get(guildId)).toEqual(DEFAULT_SETTINGS);
        });

        it("delete removes the row and leaves other guilds alone", async () => {
            const other = uniqueId("g");
            const custom = mergeSettings(DEFAULT_SETTINGS, { ghostChat: true });
            await db.settings.save(guildId, custom);
            await db.settings.save(other, custom);

            await db.settings.delete(guildId);

            expect(await db.settings.get(guildId)).toEqual(DEFAULT_SETTINGS);
            expect(await db.settings.get(other)).toEqual(custom);
        });
    });
});
