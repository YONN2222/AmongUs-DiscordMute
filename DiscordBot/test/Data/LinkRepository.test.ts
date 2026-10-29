import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe.each(backends)("LinkRepository (%s)", (backend) => {
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

        it("upsert then get", async () => {
            await db.links.upsert(g1, "u1", "Crew");
            await db.links.upsert(g1, "u1", "Renamed");
            const entry = await db.links.get(g1, "u1");
            expect(entry).toMatchObject({ guildId: g1, discordId: "u1", accountName: "Renamed" });
            expect(Number.isNaN(Date.parse(entry?.linkedAt ?? ""))).toBe(false);
        });

        it("get returns null when missing", async () => {
            expect(await db.links.get(g1, "nobody")).toBeNull();
        });

        it("remove returns false when missing", async () => {
            expect(await db.links.remove(g1, "u1")).toBe(false);
            await db.links.upsert(g1, "u1", "Crew");
            expect(await db.links.remove(g1, "u1")).toBe(true);
            expect(await db.links.get(g1, "u1")).toBeNull();
        });

        it("findByAccountName trims and matches whole names only", async () => {
            await db.links.upsert(g1, "u1", "Crew");
            await db.links.upsert(g1, "u2", "Crewmate");
            await db.links.upsert(g2, "u3", "Crew");
            const found = await db.links.findByAccountName(g1, "  Crew ");
            expect(found.map((e) => e.discordId)).toEqual(["u1"]);
        });

        it("findByAccountName is case-insensitive", async () => {
            await db.links.upsert(g1, "u1", "Crew");
            const found = await db.links.findByAccountName(g1, "cREW");
            expect(found.map((e) => e.discordId)).toEqual(["u1"]);
        });

        it("findByAccountName matches the part after a stored ' | '", async () => {
            await db.links.upsert(g1, "u1", "Clan | Cyan");
            expect((await db.links.findByAccountName(g1, "cyan")).map((e) => e.discordId)).toEqual(["u1"]);
            expect((await db.links.findByAccountName(g1, "Clan | Cyan")).map((e) => e.discordId)).toEqual(["u1"]);
            expect(await db.links.findByAccountName(g1, "Clan")).toEqual([]);
        });

        it("findByAccountName returns every link of a pipe-suffix collision", async () => {
            await db.links.upsert(g1, "u1", "Red");
            await db.links.upsert(g1, "u2", "Clan | red");
            const found = await db.links.findByAccountName(g1, "RED");
            expect(found.map((e) => e.discordId).sort()).toEqual(["u1", "u2"]);
        });

        it("pages links in case-insensitive name order", async () => {
            for (let i = 0; i < 43; i++) {
                const n = String(i).padStart(2, "0");
                await db.links.upsert(g1, `u${n}`, `Name${n}`);
            }
            await db.links.upsert(g1, "ua", "alice");
            await db.links.upsert(g1, "ub", "Bob");
            await db.links.upsert(g2, "other", "Other");

            expect(await db.links.countByGuild(g1)).toBe(45);
            expect(await db.links.countByGuild("test-nobody")).toBe(0);
            const last = await db.links.listPage(g1, 40, 20);
            expect(last).toHaveLength(5);
            const first = await db.links.listPage(g1, 0, 3);
            expect(first.map((e) => e.accountName)).toEqual(["alice", "Bob", "Name00"]);
        });

        it("keeps the friend code on an upsert with the same name and clears it for another name", async () => {
            await db.links.upsert(g1, "u1", "Crew");
            expect((await db.links.get(g1, "u1"))?.friendCode).toBeNull();
            await db.links.setFriendCode(g1, "u1", "crew#1");
            await db.links.upsert(g1, "u1", "Crew");
            expect((await db.links.get(g1, "u1"))?.friendCode).toBe("crew#1");
            await db.links.upsert(g1, "u1", "Renamed");
            expect(await db.links.get(g1, "u1")).toMatchObject({ accountName: "Renamed", friendCode: null });
        });

        it("finds links by friend code within one guild", async () => {
            await db.links.upsert(g1, "u1", "A");
            await db.links.upsert(g1, "u2", "B");
            await db.links.upsert(g2, "u3", "C");
            await db.links.setFriendCode(g1, "u1", "x#1");
            await db.links.setFriendCode(g2, "u3", "x#1");
            expect((await db.links.findByFriendCode(g1, "x#1")).map((e) => e.discordId)).toEqual(["u1"]);
            expect(await db.links.findByFriendCode(g1, "none#9")).toEqual([]);
        });

        it("renames a link and keeps its friend code", async () => {
            await db.links.upsert(g1, "u1", "Red");
            await db.links.setFriendCode(g1, "u1", "x#1");
            await db.links.rename(g1, "u1", "Crimson");
            expect(await db.links.get(g1, "u1")).toMatchObject({ accountName: "Crimson", friendCode: "x#1" });
        });

        it("listByGuild is guild-scoped", async () => {
            await db.links.upsert(g1, "u1", "A");
            await db.links.upsert(g2, "u2", "B");
            const list = await db.links.listByGuild(g1);
            expect(list.map((e) => e.discordId)).toEqual(["u1"]);
        });
    });
});
