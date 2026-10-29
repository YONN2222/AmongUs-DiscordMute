import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Database } from "../../src/Data/database";
import type { GuildSettingsRepository } from "../../src/Data/repositories/GuildSettingsRepository";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { SettingsService } from "../../src/Settings/SettingsService";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../helpers/testDatabase";

describe.each(backends)("SettingsService (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;
        let events: GuildEvent[];
        let service: SettingsService;

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("g");
            events = [];
            service = new SettingsService(db.settings, { emit: (e) => events.push(e) });
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("persists two concurrent updates on one guild", async () => {
            await Promise.all([
                service.update(guildId, "u1", { ghostChat: true }),
                service.update(guildId, "u2", { voiceRules: { meeting: { dead: "deafen" } } }),
            ]);

            const stored = await db.settings.get(guildId);
            expect(stored.ghostChat).toBe(true);
            expect(stored.voiceRules.meeting.dead).toBe("deafen");
            expect((await service.get(guildId)).ghostChat).toBe(true);
        });

        it("a fresh service reads the persisted settings", async () => {
            await service.update(guildId, "u1", { language: "de" });
            expect((await new SettingsService(db.settings).get(guildId)).language).toBe("de");
        });

        it("emits one settings-changed event with the actor and changed paths", async () => {
            const { before, after } = await service.update(guildId, "u1", {
                voiceRules: { meeting: { dead: "deafen" } },
            });

            expect(events).toEqual([
                {
                    type: "settings-changed",
                    guildId,
                    actorId: "u1",
                    paths: ["voiceRules.meeting.dead"],
                    before: DEFAULT_SETTINGS,
                    after,
                },
            ]);
            expect(before).toEqual(DEFAULT_SETTINGS);
        });

        it("emits nothing when the patch changes nothing", async () => {
            await service.update(guildId, "u1", { ghostChat: false });
            expect(events).toEqual([]);
        });
    });
});

describe("SettingsService cache", () => {
    type SpyRepo = { [K in keyof GuildSettingsRepository]: Mock<GuildSettingsRepository[K]> };

    function spyRepo(): SpyRepo {
        return {
            get: vi.fn(async () => DEFAULT_SETTINGS),
            save: vi.fn(async () => {}),
            delete: vi.fn(async () => {}),
        };
    }

    it("reads the repository once per guild", async () => {
        const repo = spyRepo();
        const service = new SettingsService(repo);

        await service.get("g1");
        await service.get("g1");

        expect(repo.get).toHaveBeenCalledTimes(1);
    });

    it("serves a guild from the cache after an update", async () => {
        const repo = spyRepo();
        const service = new SettingsService(repo);

        await service.update("g1", "u1", { ghostChat: true });
        const settings = await service.get("g1");

        expect(settings.ghostChat).toBe(true);
        expect(repo.get).toHaveBeenCalledTimes(1);
    });

    it("keeps the cache unchanged when saving fails", async () => {
        const repo = spyRepo();
        repo.save.mockRejectedValueOnce(new Error("disk full"));
        const service = new SettingsService(repo);

        await expect(service.update("g1", "u1", { ghostChat: true })).rejects.toThrow("disk full");

        expect((await service.get("g1")).ghostChat).toBe(false);
        await service.update("g1", "u1", { autoRelink: false });
        expect((await service.get("g1")).autoRelink).toBe(false);
    });
});
