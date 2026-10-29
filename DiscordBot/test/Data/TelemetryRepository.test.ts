import { Database as BunDatabase } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../../src/Data/Database";
import {
    type Backend,
    backendAvailable,
    backends,
    openBackend,
    postgresUrl,
    purgeTestRows,
    uniqueId,
} from "../Helpers/TestDatabase";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const opened: Database[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(opened.splice(0).map((db) => db.close()));
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function track(db: Promise<Database>): Promise<Database> {
    const database = await db;
    opened.push(database);
    return database;
}

function tempStorage(): string {
    const dir = mkdtempSync(join(tmpdir(), "dm-telemetry-"));
    tempDirs.push(dir);
    return join(dir, "linking.sqlite");
}

describe.each(backends)("TelemetryRepository (%s)", (backend: Backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        it("instance id is a uuid v4 and stable across reopen", async () => {
            const options =
                backend === "postgres"
                    ? ({ dialect: "postgres", url: postgresUrl as string } as const)
                    : ({ dialect: "sqlite", storage: tempStorage() } as const);

            const first = await openDatabase(options);
            const firstId = await first.telemetry.getOrCreateInstanceId().finally(() => first.close());
            const second = await track(openDatabase(options));

            expect(firstId).toMatch(UUID_V4);
            expect(await second.telemetry.getOrCreateInstanceId()).toBe(firstId);
        });

        it("two concurrent calls return the same id", async () => {
            const db = await track(openBackend(backend));
            const ids = await Promise.all([db.telemetry.getOrCreateInstanceId(), db.telemetry.getOrCreateInstanceId()]);
            expect(ids[0]).toBe(ids[1]);
            expect(ids[0]).toMatch(UUID_V4);
        });

        it("countLinkedUsers counts a user linked in two guilds once", async () => {
            const db = await track(openBackend(backend));
            const before = await db.telemetry.countLinkedUsers();
            const user = uniqueId("user");
            try {
                await db.links.upsert(uniqueId("g1"), user, "Crew");
                await db.links.upsert(uniqueId("g2"), user, "Crew");
                expect(await db.telemetry.countLinkedUsers()).toBe(before + 1);
            } finally {
                await purgeTestRows(db);
            }
        });
    });
});

describe("TelemetryRepository (sqlite specifics)", () => {
    it("countLinkedUsers is 0 on an empty table", async () => {
        const db = await track(openDatabase({ dialect: "sqlite", storage: ":memory:" }));
        expect(await db.telemetry.countLinkedUsers()).toBe(0);
    });

    it("migration adopts a database migrated by an earlier version", async () => {
        const storage = tempStorage();
        const earlier = await openDatabase({ dialect: "sqlite", storage });
        await earlier.links.upsert("g1", "u1", "Crew");
        await earlier.close();

        const raw = new BunDatabase(storage);
        raw.run("DROP TABLE bot_meta");
        raw.run("DELETE FROM schema_migrations WHERE name = '0010-bot-meta'");
        raw.close();

        const db = await track(openDatabase({ dialect: "sqlite", storage }));
        expect(await db.telemetry.getOrCreateInstanceId()).toMatch(UUID_V4);
        expect((await db.links.get("g1", "u1"))?.accountName).toBe("Crew");
    });
});
