import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/database";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../helpers/testDatabase";

describe.each(backends)("MuteLedgerRepository (%s)", (backend) => {
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

        it("add is idempotent and listByGuild is guild-scoped", async () => {
            await db.muteLedger.add(g1, "u1");
            await db.muteLedger.add(g1, "u1");
            await db.muteLedger.add(g2, "u2");
            const list = await db.muteLedger.listByGuild(g1);
            expect(list).toHaveLength(1);
            expect(list[0]).toMatchObject({ guildId: g1, discordId: "u1" });
            expect(typeof list[0]?.mutedAt).toBe("number");
        });

        it("remove deletes only the given entry", async () => {
            await db.muteLedger.add(g1, "u1");
            await db.muteLedger.add(g1, "u2");
            await db.muteLedger.remove(g1, "u1");
            await db.muteLedger.remove(g1, "missing");
            expect((await db.muteLedger.listByGuild(g1)).map((e) => e.discordId)).toEqual(["u2"]);
        });

        it("has reports a guild-scoped entry", async () => {
            await db.muteLedger.add(g1, "u1");
            expect(await db.muteLedger.has(g1, "u1")).toBe(true);
            expect(await db.muteLedger.has(g2, "u1")).toBe(false);
            expect(await db.muteLedger.has(g1, "u2")).toBe(false);
        });
    });
});
