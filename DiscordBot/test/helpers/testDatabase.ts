import { randomUUID } from "node:crypto";
import { type Database, openDatabase } from "../../src/Data/database";

export type Backend = "sqlite" | "postgres";

export const backends: readonly Backend[] = ["sqlite", "postgres"];
export const postgresUrl = process.env.TEST_POSTGRES_URL;

export function backendAvailable(backend: Backend): boolean {
    return backend === "sqlite" || postgresUrl !== undefined;
}

export function openBackend(backend: Backend): Promise<Database> {
    if (backend === "postgres") {
        return openDatabase({ dialect: "postgres", url: postgresUrl as string });
    }
    return openDatabase({ dialect: "sqlite", storage: ":memory:" });
}

export function createTestDatabase(): Promise<Database> {
    return openBackend("sqlite");
}

/** Postgres tests share one database, so every test works on ids that cannot collide. */
export function uniqueId(prefix: string): string {
    return `test-${prefix}-${randomUUID()}`;
}

export async function purgeTestRows(db: Database): Promise<void> {
    await db.sequelize.query("DELETE FROM links WHERE guild_id LIKE 'test-%'");
    await db.sequelize.query("DELETE FROM pending_links WHERE guild_id LIKE 'test-%'");
    await db.sequelize.query("DELETE FROM mute_ledger WHERE guild_id LIKE 'test-%'");
    await db.sequelize.query("DELETE FROM nickname_ledger WHERE guild_id LIKE 'test-%'");
    await db.sequelize.query("DELETE FROM guild_settings WHERE guild_id LIKE 'test-%'");
    await db.sequelize.query("DELETE FROM tracked_messages WHERE guild_id LIKE 'test-%'");
}
