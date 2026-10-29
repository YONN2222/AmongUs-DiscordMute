import { Database as BunDatabase } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../../src/Data/Database";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

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

        it("add marks a mute and keeps an existing deafen", async () => {
            await db.muteLedger.set(g1, "u1", { muted: false, deafened: true });
            await db.muteLedger.add(g1, "u1");
            await db.muteLedger.add(g1, "u2");

            expect(await db.muteLedger.get(g1, "u1")).toMatchObject({ muted: true, deafened: true });
            expect(await db.muteLedger.get(g1, "u2")).toMatchObject({ muted: true, deafened: false });
            expect(await db.muteLedger.get(g1, "nobody")).toBeNull();
        });

        it("set stores both flags and deletes the row when none is left", async () => {
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: true });
            await db.muteLedger.set(g1, "u1", { muted: false, deafened: true });
            expect(await db.muteLedger.get(g1, "u1")).toMatchObject({ muted: false, deafened: true });
            expect(await db.muteLedger.has(g1, "u1")).toBe(true);

            await db.muteLedger.set(g1, "u1", { muted: false, deafened: false });
            expect(await db.muteLedger.get(g1, "u1")).toBeNull();
            expect(await db.muteLedger.has(g1, "u1")).toBe(false);
        });

        it("reads a row written before deafen tracking as muted only", async () => {
            await db.sequelize.query(
                `INSERT INTO mute_ledger (guild_id, discord_id, muted_at) VALUES ('${g1}', 'old', 1700000000000)`,
            );

            expect(await db.muteLedger.get(g1, "old")).toEqual({
                guildId: g1,
                discordId: "old",
                mutedAt: 1700000000000,
                muted: true,
                deafened: false,
            });
        });

        it("listByGuilds spans guilds and ignores others", async () => {
            const g3 = uniqueId("g3");
            await db.muteLedger.add(g1, "u1");
            await db.muteLedger.add(g2, "u2");
            await db.muteLedger.add(g3, "u3");

            const list = await db.muteLedger.listByGuilds([g1, g2]);

            expect(list.map((e) => e.discordId).sort()).toEqual(["u1", "u2"]);
            expect(await db.muteLedger.listByGuilds([])).toEqual([]);
        });

        it("listByGuilds handles more guilds than one query parameter batch", async () => {
            const many = Array.from({ length: 1200 }, (_, i) => `${g1}-${i}`);
            await db.muteLedger.add(many[1199], "u1");

            expect((await db.muteLedger.listByGuilds(many)).map((e) => e.discordId)).toEqual(["u1"]);
        });

        it("has reports a guild-scoped entry", async () => {
            await db.muteLedger.add(g1, "u1");
            expect(await db.muteLedger.has(g1, "u1")).toBe(true);
            expect(await db.muteLedger.has(g2, "u1")).toBe(false);
            expect(await db.muteLedger.has(g1, "u2")).toBe(false);
        });
    });
});

describe("MuteLedgerRepository (sqlite upgrade)", () => {
    it("keeps rows of an older ledger as mutes without deafen", async () => {
        const dir = mkdtempSync(join(tmpdir(), "dm-ledger-"));
        const storage = join(dir, "linking.sqlite");
        const legacy = new BunDatabase(storage, { create: true });
        legacy.run(
            "CREATE TABLE `mute_ledger` (`guild_id` VARCHAR(255) NOT NULL, `discord_id` VARCHAR(255) NOT NULL, `muted_at` BIGINT NOT NULL, PRIMARY KEY (`guild_id`, `discord_id`))",
        );
        legacy.run("INSERT INTO mute_ledger VALUES ('g1', 'u1', 1700000000000)");
        legacy.close();

        const db = await openDatabase({ dialect: "sqlite", storage });
        try {
            expect(await db.muteLedger.listByGuild("g1")).toEqual([
                { guildId: "g1", discordId: "u1", mutedAt: 1700000000000, muted: true, deafened: false },
            ]);
        } finally {
            await db.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
