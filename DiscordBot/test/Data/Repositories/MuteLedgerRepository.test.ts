import { Database as BunDatabase } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../../../src/Data/Database";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../../Helpers/TestDatabase";

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

        it("set is idempotent and listByGuild is guild-scoped", async () => {
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: false }, null);
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: false }, null);
            await db.muteLedger.set(g2, "u2", { muted: true, deafened: false }, null);
            const list = await db.muteLedger.listByGuild(g1);
            expect(list).toHaveLength(1);
            expect(list[0]).toMatchObject({ guildId: g1, discordId: "u1" });
            expect(typeof list[0]?.mutedAt).toBe("number");
        });

        it("remove deletes only the given entry", async () => {
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: false }, null);
            await db.muteLedger.set(g1, "u2", { muted: true, deafened: false }, null);
            await db.muteLedger.remove(g1, "u1");
            await db.muteLedger.remove(g1, "missing");
            expect((await db.muteLedger.listByGuild(g1)).map((e) => e.discordId)).toEqual(["u2"]);
        });

        it("set replaces both flags of an existing entry", async () => {
            await db.muteLedger.set(g1, "u1", { muted: false, deafened: true }, null);
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: false }, null);
            await db.muteLedger.set(g1, "u2", { muted: true, deafened: false }, null);

            expect(await db.muteLedger.get(g1, "u1")).toMatchObject({ muted: true, deafened: false });
            expect(await db.muteLedger.get(g1, "u2")).toMatchObject({ muted: true, deafened: false });
            expect(await db.muteLedger.get(g1, "nobody")).toBeNull();
        });

        it("set stores both flags and deletes the row when none is left", async () => {
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: true }, null);
            await db.muteLedger.set(g1, "u1", { muted: false, deafened: true }, null);
            expect(await db.muteLedger.get(g1, "u1")).toMatchObject({ muted: false, deafened: true });
            expect(await db.muteLedger.has(g1, "u1")).toBe(true);

            await db.muteLedger.set(g1, "u1", { muted: false, deafened: false }, null);
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
                sessionId: null,
            });
        });

        it("stores the session of the last writer and replaces it on the next set", async () => {
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: false }, "A");
            expect(await db.muteLedger.get(g1, "u1")).toMatchObject({ sessionId: "A" });

            await db.muteLedger.set(g1, "u1", { muted: true, deafened: true }, "B");
            expect(await db.muteLedger.get(g1, "u1")).toMatchObject({ deafened: true, sessionId: "B" });

            await db.muteLedger.set(g1, "u1", { muted: true, deafened: true }, "C");
            await db.muteLedger.set(g1, "u2", { muted: true, deafened: false }, null);
            expect(await db.muteLedger.get(g1, "u1")).toMatchObject({ muted: true, deafened: true, sessionId: "C" });
            expect(await db.muteLedger.get(g1, "u2")).toMatchObject({ sessionId: null });
            expect((await db.muteLedger.listByGuilds([g1])).map((e) => e.sessionId).sort()).toEqual(["C", null]);
        });

        it("listByGuilds spans guilds and ignores others", async () => {
            const g3 = uniqueId("g3");
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: false }, null);
            await db.muteLedger.set(g2, "u2", { muted: true, deafened: false }, null);
            await db.muteLedger.set(g3, "u3", { muted: true, deafened: false }, null);

            const list = await db.muteLedger.listByGuilds([g1, g2]);

            expect(list.map((e) => e.discordId).sort()).toEqual(["u1", "u2"]);
            expect(await db.muteLedger.listByGuilds([])).toEqual([]);
        });

        it("listByGuilds handles more guilds than one query parameter batch", async () => {
            const many = Array.from({ length: 1200 }, (_, i) => `${g1}-${i}`);
            await db.muteLedger.set(many[1199], "u1", { muted: true, deafened: false }, null);

            expect((await db.muteLedger.listByGuilds(many)).map((e) => e.discordId)).toEqual(["u1"]);
        });

        it("has reports a guild-scoped entry", async () => {
            await db.muteLedger.set(g1, "u1", { muted: true, deafened: false }, null);
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
                {
                    guildId: "g1",
                    discordId: "u1",
                    mutedAt: 1700000000000,
                    muted: true,
                    deafened: false,
                    sessionId: null,
                },
            ]);
        } finally {
            await db.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
