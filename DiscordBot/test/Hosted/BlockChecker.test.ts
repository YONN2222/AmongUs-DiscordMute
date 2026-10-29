import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe.each(backends)("BlockChecker (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let checker: BlockChecker;
        let guildId: string;
        let ownerId: string;

        const storeGuild = () =>
            db.hostedGuilds.upsert({ guildId, name: "Guild", icon: null, ownerId, memberCount: 3, joinedAt: 1 });
        const block = (type: "user" | "guild", targetId: string) =>
            db.blocks.create({ type, targetId, reason: "test", blockedBy: "admin" });

        beforeEach(async () => {
            db = await openBackend(backend);
            checker = new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds });
            guildId = uniqueId("guild");
            ownerId = uniqueId("owner");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("a user is blocked only after a user block", async () => {
            expect(await checker.isUserBlocked(ownerId)).toBe(false);
            await block("user", ownerId);
            expect(await checker.isUserBlocked(ownerId)).toBe(true);
        });

        it("a guild block does not block a user with the same id", async () => {
            await block("guild", ownerId);
            expect(await checker.isUserBlocked(ownerId)).toBe(false);
        });

        it("a guild is blocked by its own block", async () => {
            await storeGuild();
            expect(await checker.isGuildBlocked(guildId)).toBe(false);
            await block("guild", guildId);
            expect(await checker.isGuildBlocked(guildId)).toBe(true);
        });

        it("a guild is blocked when its stored owner is blocked", async () => {
            await storeGuild();
            await block("user", ownerId);
            expect(await checker.isGuildBlocked(guildId)).toBe(true);
        });

        it("a guild without stored data is not blocked by an owner", async () => {
            expect(await checker.isGuildBlocked(guildId)).toBe(false);
        });
    });
});
