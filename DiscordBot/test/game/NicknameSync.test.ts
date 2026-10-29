import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/database";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { type NicknameAdapter, NicknameSync } from "../../src/Game/NicknameSync";
import { logger } from "../../src/Logging/logger";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../helpers/testDatabase";

const VOICE = "v1";

class FakeAdapter implements NicknameAdapter {
    readonly nicks = new Map<string, string | null>();
    readonly voice = new Map<string, string | null>();
    readonly failing = new Set<string>();
    readonly lookupFails = new Set<string>();
    readonly sets: Array<{ discordId: string; nick: string | null }> = [];

    join(discordId: string, nick: string | null, channelId: string | null = VOICE): void {
        this.nicks.set(discordId, nick);
        this.voice.set(discordId, channelId);
    }

    async nicknameOf(_guildId: string, discordId: string) {
        if (this.lookupFails.has(discordId)) throw new Error("Discord is unreachable");
        return this.nicks.has(discordId) ? { nick: this.nicks.get(discordId) ?? null } : null;
    }

    async voiceChannelOf(_guildId: string, discordId: string) {
        return this.voice.get(discordId) ?? null;
    }

    async setNickname(_guildId: string, discordId: string, nick: string | null) {
        if (this.failing.has(discordId)) throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
        this.sets.push({ discordId, nick });
        this.nicks.set(discordId, nick);
    }
}

describe.each(backends)("NicknameSync (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;
        let adapter: FakeAdapter;
        let emit: ReturnType<typeof vi.fn<(e: GuildEvent) => void>>;
        let settings: GuildSettings;
        let sync: NicknameSync;

        function gameEvent(event: "game-start" | "lobby", players: string[], channelIds = [VOICE]): GuildEvent {
            return {
                type: "game-event",
                guildId,
                sessionId: "s1",
                event,
                hostAccountName: "Red",
                players,
                deadPlayers: [],
                channelIds,
            };
        }

        beforeEach(async () => {
            vi.spyOn(logger, "error").mockImplementation(() => {});
            vi.spyOn(logger, "warn").mockImplementation(() => {});
            db = await openBackend(backend);
            guildId = uniqueId("g");
            adapter = new FakeAdapter();
            emit = vi.fn<(e: GuildEvent) => void>();
            settings = { ...DEFAULT_SETTINGS, nicknameSync: true };
            sync = new NicknameSync({
                adapter,
                ledger: db.nicknameLedger,
                links: db.links,
                settings: { get: async () => settings },
                events: { emit },
            });
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
            vi.restoreAllMocks();
        });

        it("sets the game name and restores the original nickname at the lobby", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            adapter.join("u1", "Bob");

            await sync.handle(gameEvent("game-start", ["Red"]));

            expect(adapter.nicks.get("u1")).toBe("Red");
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([
                { guildId, discordId: "u1", originalNick: "Bob", appliedNick: "Red" },
            ]);

            await sync.handle(gameEvent("lobby", []));

            expect(adapter.nicks.get("u1")).toBe("Bob");
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
        });

        it("restores a member without a nickname back to none", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            adapter.join("u1", null);

            await sync.handle(gameEvent("game-start", ["Red"]));
            await sync.handle(gameEvent("lobby", []));

            expect(adapter.sets).toEqual([
                { discordId: "u1", nick: "Red" },
                { discordId: "u1", nick: null },
            ]);
        });

        it("restore leaves a nickname the member changed", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            adapter.join("u1", "Bob");
            await sync.handle(gameEvent("game-start", ["Red"]));
            adapter.nicks.set("u1", "Custom");
            adapter.sets.length = 0;

            await sync.handle(gameEvent("lobby", []));

            expect(adapter.sets).toEqual([]);
            expect(adapter.nicks.get("u1")).toBe("Custom");
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
        });

        it("keeps the ledger row when the restore lacks permission and retries later", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            adapter.join("u1", "Bob");
            await sync.handle(gameEvent("game-start", ["Red"]));
            adapter.failing.add("u1");

            await sync.handle(gameEvent("lobby", []));

            expect(adapter.nicks.get("u1")).toBe("Red");
            expect(await db.nicknameLedger.listByGuild(guildId)).toHaveLength(1);

            adapter.failing.delete("u1");
            await sync.restoreGuild(guildId);

            expect(adapter.nicks.get("u1")).toBe("Bob");
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
        });

        it("a 50013 member is skipped and the rest are renamed", async () => {
            for (const [id, name] of [
                ["u1", "Red"],
                ["u2", "Blue"],
                ["u3", "Green"],
            ]) {
                await db.links.upsert(guildId, id, name);
                adapter.join(id, `nick-${id}`);
            }
            adapter.failing.add("u2");

            await sync.handle(gameEvent("game-start", ["Red", "Blue", "Green"]));

            expect(adapter.nicks.get("u1")).toBe("Red");
            expect(adapter.nicks.get("u2")).toBe("nick-u2");
            expect(adapter.nicks.get("u3")).toBe("Green");
            expect((await db.nicknameLedger.listByGuild(guildId)).map((e) => e.discordId).sort()).toEqual(["u1", "u3"]);
            expect(emit).toHaveBeenCalledTimes(1);
            expect(emit).toHaveBeenCalledWith({
                type: "voice-error",
                guildId,
                code: "member-not-editable",
                discordId: "u2",
            });
        });

        it("reports a member that cannot be edited once per game", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.upsert(guildId, "u2", "Blue");
            adapter.join("u1", "a");
            adapter.join("u2", "b");
            adapter.failing.add("u1");
            adapter.failing.add("u2");

            await sync.handle(gameEvent("game-start", ["Red", "Blue"]));
            await sync.handle(gameEvent("game-start", ["Red", "Blue"]));
            expect(emit).toHaveBeenCalledTimes(1);

            await sync.handle(gameEvent("lobby", []));
            await sync.handle(gameEvent("game-start", ["Red"]));
            expect(emit).toHaveBeenCalledTimes(2);
        });

        it("truncates a long name to 32 characters", async () => {
            const long = "A".repeat(40);
            await db.links.upsert(guildId, "u1", long);
            adapter.join("u1", "Bob");

            await sync.handle(gameEvent("game-start", [long]));

            expect(adapter.nicks.get("u1")).toBe("A".repeat(32));
        });

        it("makes no calls when nickname sync is off", async () => {
            settings = { ...DEFAULT_SETTINGS, nicknameSync: false };
            await db.links.upsert(guildId, "u1", "Red");
            adapter.join("u1", "Bob");

            await sync.handle(gameEvent("game-start", ["Red"]));

            expect(adapter.sets).toEqual([]);
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
        });

        it("skips players outside the game channels, unlinked names and ambiguous names", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.upsert(guildId, "u2", "Blue");
            await db.links.upsert(guildId, "u3", "Green");
            await db.links.upsert(guildId, "u4", "Clan | Green");
            adapter.join("u1", "a", "other-channel");
            adapter.join("u2", "b");
            adapter.join("u3", "c");
            adapter.join("u4", "d");

            await sync.handle(gameEvent("game-start", ["Red", "Blue", "Green", "Nobody"]));

            expect(adapter.sets).toEqual([{ discordId: "u2", nick: "Blue" }]);
        });

        it("does nothing without used channels", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            adapter.join("u1", "Bob");

            await sync.handle(gameEvent("game-start", ["Red"], []));

            expect(adapter.sets).toEqual([]);
        });

        it("keeps the first original nickname when a game start repeats with another name", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            adapter.join("u1", "Bob");
            await sync.handle(gameEvent("game-start", ["Red"]));
            await db.links.rename(guildId, "u1", "Crimson");

            await sync.handle(gameEvent("game-start", ["Crimson"]));
            await sync.handle(gameEvent("lobby", []));

            expect(adapter.nicks.get("u1")).toBe("Bob");
        });

        it("recover restores rows left behind by a crash and drops rows of missing members", async () => {
            await db.nicknameLedger.set(guildId, "u1", "Bob", "Red");
            await db.nicknameLedger.set(guildId, "gone", "Old", "Blue");
            adapter.join("u1", "Red");

            await sync.recover([guildId, uniqueId("empty")]);

            expect(adapter.nicks.get("u1")).toBe("Bob");
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
        });

        it("keeps the row when the member lookup fails and drops it only for a member who is gone", async () => {
            await db.nicknameLedger.set(guildId, "u1", "Bob", "Red");
            await db.nicknameLedger.set(guildId, "gone", "Old", "Blue");
            adapter.join("u1", "Red");
            adapter.lookupFails.add("u1");

            await sync.restoreGuild(guildId);

            expect((await db.nicknameLedger.listByGuild(guildId)).map((e) => e.discordId)).toEqual(["u1"]);
            expect(adapter.nicks.get("u1")).toBe("Red");

            adapter.lookupFails.delete("u1");
            await sync.restoreGuild(guildId);

            expect(adapter.nicks.get("u1")).toBe("Bob");
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
        });

        it("keeps the row and logs when restoring fails for missing permissions", async () => {
            await db.nicknameLedger.set(guildId, "u1", "Bob", "Red");
            adapter.join("u1", "Red");
            adapter.failing.add("u1");

            await sync.restoreGuild(guildId);

            expect(await db.nicknameLedger.listByGuild(guildId)).toHaveLength(1);
            expect(logger.error).toHaveBeenCalled();
        });
    });
});
