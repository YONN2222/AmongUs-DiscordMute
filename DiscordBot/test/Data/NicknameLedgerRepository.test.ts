import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe.each(backends)("NicknameLedgerRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let g1: string;
        let g2: string;

        beforeEach(async () => {
            db = await openBackend(backend);
            g1 = uniqueId("g1");
            g2 = uniqueId("g2");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("stores an original nickname and replaces the row on a second set", async () => {
            await db.nicknameLedger.set(g1, "u1", "Bob", "Red", null);
            await db.nicknameLedger.set(g1, "u1", "Bob", "Crimson", null);
            expect(await db.nicknameLedger.listByGuild(g1)).toEqual([
                { guildId: g1, discordId: "u1", originalNick: "Bob", appliedNick: "Crimson", sessionId: null },
            ]);
        });

        it("stores the session of the last writer", async () => {
            await db.nicknameLedger.set(g1, "u1", "Bob", "Red", "A");
            await db.nicknameLedger.set(g1, "u2", "Ann", "Blue", "A");
            await db.nicknameLedger.set(g1, "u1", "Bob", "Red", "B");
            const sessions = (await db.nicknameLedger.listByGuild(g1)).map((e) => [e.discordId, e.sessionId]).sort();
            expect(sessions).toEqual([
                ["u1", "B"],
                ["u2", "A"],
            ]);
        });

        it("keeps a missing original nickname as null", async () => {
            await db.nicknameLedger.set(g1, "u1", null, "Red", null);
            expect((await db.nicknameLedger.listByGuild(g1))[0].originalNick).toBeNull();
        });

        it("lists by guild and by several guilds", async () => {
            await db.nicknameLedger.set(g1, "u1", "A", "X", null);
            await db.nicknameLedger.set(g2, "u2", "B", "Y", null);
            expect((await db.nicknameLedger.listByGuild(g1)).map((e) => e.discordId)).toEqual(["u1"]);
            expect((await db.nicknameLedger.listByGuilds([g1, g2])).map((e) => e.discordId).sort()).toEqual([
                "u1",
                "u2",
            ]);
            expect(await db.nicknameLedger.listByGuilds([])).toEqual([]);
        });

        it("removes a row", async () => {
            await db.nicknameLedger.set(g1, "u1", "A", "X", null);
            await db.nicknameLedger.remove(g1, "u1");
            await db.nicknameLedger.remove(g1, "u1");
            expect(await db.nicknameLedger.listByGuild(g1)).toEqual([]);
        });
    });
});
