import { Database as BunDatabase } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryTypes, Sequelize } from "sequelize";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Database, openDatabase } from "../../src/Data/Database";
import { writeRepeatedly } from "../Helpers/SqliteWriter";
import {
    type Backend,
    backendAvailable,
    backends,
    openBackend,
    postgresUrl,
    purgeTestRows,
    uniqueId,
} from "../Helpers/TestDatabase";

const opened: Database[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(opened.splice(0).map((db) => db.close()));
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function track(db: Promise<Database>): Promise<Database> {
    const database = await db;
    opened.push(database);
    return database;
}

function tempStorage(): string {
    const dir = mkdtempSync(join(tmpdir(), "dm-db-"));
    tempDirs.push(dir);
    return join(dir, "linking.sqlite");
}

async function tableNames(db: Database): Promise<string[]> {
    const names = await db.sequelize.getQueryInterface().showAllTables();
    return names.map(String);
}

describe.each(backends)("openDatabase (%s)", (backend: Backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        it("migrates an empty database", async () => {
            const db = await track(openBackend(backend));
            const tables = await tableNames(db);
            expect(tables).toEqual(
                expect.arrayContaining(["links", "pending_links", "mute_ledger", "schema_migrations"]),
            );
        });

        it("migrations are idempotent", async () => {
            const options =
                backend === "postgres"
                    ? ({ dialect: "postgres", url: postgresUrl as string } as const)
                    : ({ dialect: "sqlite", storage: tempStorage() } as const);
            const guild = uniqueId("idem");

            const first = await openDatabase(options);
            try {
                await first.links.upsert(guild, "u1", "Crew");
            } finally {
                await first.close();
            }

            const second = await track(openDatabase(options));
            try {
                expect((await second.links.get(guild, "u1"))?.accountName).toBe("Crew");
            } finally {
                await purgeTestRows(second);
            }
        });
    });
});

describe("openDatabase (sqlite specifics)", () => {
    it("adopts an existing v2.1 links table and keeps rows", async () => {
        const storage = tempStorage();
        const legacy = new BunDatabase(storage, { create: true });
        legacy.run(
            "CREATE TABLE `links` (`guild_id` VARCHAR(255) NOT NULL, `discord_id` VARCHAR(255) NOT NULL, `account_name` VARCHAR(255) NOT NULL, `linked_at` VARCHAR(255) NOT NULL, PRIMARY KEY (`guild_id`, `discord_id`))",
        );
        legacy.run("INSERT INTO links VALUES ('g1', 'u1', 'Crew', '2026-01-01T00:00:00.000Z')");
        legacy.close();

        const db = await track(openDatabase({ dialect: "sqlite", storage }));
        expect(await db.links.get("g1", "u1")).toEqual({
            guildId: "g1",
            discordId: "u1",
            accountName: "Crew",
            linkedAt: "2026-01-01T00:00:00.000Z",
            friendCode: null,
        });
    });

    it("keeps open pending links when it scopes their codes to the guild", async () => {
        const storage = tempStorage();
        const earlier = await openDatabase({ dialect: "sqlite", storage });
        await earlier.close();

        const raw = new BunDatabase(storage);
        raw.run("DROP TABLE pending_links");
        raw.run(
            "CREATE TABLE pending_links (guild_id VARCHAR(255) NOT NULL, discord_id VARCHAR(255) NOT NULL, phrase VARCHAR(255) NOT NULL UNIQUE, quick_chat_code VARCHAR(255) NOT NULL UNIQUE, quick_chat_ids VARCHAR(255) NOT NULL, expires_at BIGINT NOT NULL, application_id TEXT, interaction_token TEXT, locale TEXT, PRIMARY KEY (guild_id, discord_id))",
        );
        raw.run(
            "INSERT INTO pending_links VALUES ('g1', 'u1', 'link-AAAA', '3-7', '[3,7]', 9999999999999, 'app', 'token', 'de')",
        );
        raw.run("DELETE FROM schema_migrations WHERE name = '0017-pending-link-guild-codes'");
        raw.close();

        const db = await track(openDatabase({ dialect: "sqlite", storage }));
        expect(await db.pendingLinks.getActive("g1", "u1", Date.now())).toEqual({
            guildId: "g1",
            discordId: "u1",
            phrase: "link-AAAA",
            quickChatCode: "3-7",
            quickChatIds: [3, 7],
            expiresAt: 9999999999999,
            applicationId: "app",
            interactionToken: "token",
            locale: "de",
        });
        await db.pendingLinks.create({
            guildId: "g2",
            discordId: "u1",
            phrase: "link-AAAA",
            quickChatCode: "3-7",
            quickChatIds: [3, 7],
            expiresAt: 9999999999999,
        });
        expect(await db.pendingLinks.countActive("g2", Date.now())).toBe(1);
    });

    it("migrate: false does not create tables on an empty database", async () => {
        const db = await track(openDatabase({ dialect: "sqlite", storage: ":memory:" }, { migrate: false }));
        expect(await tableNames(db)).toEqual([]);
    });

    it("keeps two open databases isolated", async () => {
        const a = await track(openDatabase({ dialect: "sqlite", storage: tempStorage() }));
        const b = await track(openDatabase({ dialect: "sqlite", storage: tempStorage() }));

        await a.links.upsert("g1", "u1", "OnlyInA");
        await b.links.upsert("g1", "u1", "OnlyInB");
        await b.links.upsert("g1", "u2", "ExtraInB");

        expect((await a.links.get("g1", "u1"))?.accountName).toBe("OnlyInA");
        expect((await b.links.get("g1", "u1"))?.accountName).toBe("OnlyInB");
        expect(await a.links.get("g1", "u2")).toBeNull();

        await a.close();
        opened.splice(opened.indexOf(a), 1);

        expect((await b.links.get("g1", "u2"))?.accountName).toBe("ExtraInB");
        await b.links.upsert("g1", "u3", "StillWorks");
        expect(await b.links.listByGuild("g1")).toHaveLength(3);
    });

    it("uses WAL with a busy timeout for file databases", async () => {
        const db = await track(openDatabase({ dialect: "sqlite", storage: tempStorage() }));
        const [journal] = (await db.sequelize.query("PRAGMA journal_mode", { type: QueryTypes.SELECT })) as {
            journal_mode: string;
        }[];
        const [busy] = (await db.sequelize.query("PRAGMA busy_timeout", { type: QueryTypes.SELECT })) as {
            timeout: number;
        }[];
        expect(journal?.journal_mode).toBe("wal");
        expect(busy?.timeout).toBe(5000);
    });

    it("lets two processes write to the same file at once without SQLITE_BUSY", async () => {
        const storage = tempStorage();
        const db = await track(openDatabase({ dialect: "sqlite", storage }));
        const iterations = 150;
        const child = Bun.spawn(
            [process.execPath, join(__dirname, "../Helpers/SqliteWriterProcess.ts"), storage, "child", `${iterations}`],
            { stdout: "ignore", stderr: "pipe" },
        );

        const local = writeRepeatedly(db, "local", iterations).then(
            () => null,
            (error: unknown) => error,
        );
        const [exitCode, stderr, localError] = await Promise.all([
            child.exited,
            new Response(child.stderr).text(),
            local,
        ]);

        expect(localError).toBeNull();
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(await db.muteLedger.listByGuild("child-guild")).toEqual([]);
        expect(await db.muteLedger.listByGuild("local-guild")).toEqual([]);
    }, 60_000);

    it("closes the connection and rethrows when authenticate fails", async () => {
        const closeSpy = vi.spyOn(Sequelize.prototype, "close");
        vi.spyOn(Sequelize.prototype, "authenticate").mockRejectedValueOnce(new Error("no connection"));

        await expect(openDatabase({ dialect: "sqlite", storage: ":memory:" })).rejects.toThrow("no connection");
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it("closes the connection and rethrows when a migration fails", async () => {
        const closeSpy = vi.spyOn(Sequelize.prototype, "close");
        const originalQuery = Sequelize.prototype.query;
        vi.spyOn(Sequelize.prototype, "query").mockImplementation(function (
            this: Sequelize,
            sql: string | { query: string; values: unknown[] },
            options: never,
        ) {
            if (typeof sql === "string" && sql.includes("CREATE TABLE IF NOT EXISTS links")) {
                return Promise.reject(new Error("migration boom"));
            }
            return originalQuery.call(this, sql, options) as never;
        } as typeof Sequelize.prototype.query);

        await expect(openDatabase({ dialect: "sqlite", storage: ":memory:" })).rejects.toThrow("migration boom");
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });
});
