import { Database as BunDatabase } from "bun:sqlite";

const OPEN_READWRITE = 0x00000002;
const OPEN_CREATE = 0x00000004;

type RunCallback = (this: { lastID: number; changes: number }, err: Error | null) => void;
type AllCallback = (err: Error | null, rows: unknown[]) => void;

function normalizeParams(params: unknown): unknown[] | Record<string, unknown> {
    if (Array.isArray(params)) return params;
    if (params && typeof params === "object") return params as Record<string, unknown>;
    return [];
}

class BunSqliteConnection {
    readonly filename: string;
    private readonly db!: BunDatabase;

    constructor(storage: string, _mode: number, callback?: (err: Error | null) => void) {
        this.filename = storage;
        try {
            this.db = new BunDatabase(storage, { create: true });
            // Deferred: node-sqlite3 invokes this callback after the caller has already
            // stored the `new Database(...)` return value, calling it synchronously here
            // would run it before that assignment completes.
            queueMicrotask(() => callback?.(null));
        } catch (err) {
            queueMicrotask(() => callback?.(err as Error));
        }
    }

    serialize(fn: () => void): void {
        fn();
    }

    run(sql: string, params: unknown, callback?: RunCallback): void {
        if (typeof params === "function") {
            callback = params as RunCallback;
            params = [];
        }

        try {
            // biome-ignore lint: bun:sqlite's binding types are too narrow for the loosely-typed params Sequelize passes through
            this.db.query(sql).run(normalizeParams(params) as any);
            const changes = (this.db.query("SELECT changes() AS value").get() as { value: number }).value;
            const lastId = (this.db.query("SELECT last_insert_rowid() AS value").get() as { value: number }).value;
            callback?.call({ lastID: lastId, changes }, null);
        } catch (err) {
            callback?.call({ lastID: 0, changes: 0 }, err as Error);
        }
    }

    all(sql: string, params: unknown, callback?: AllCallback): void {
        if (typeof params === "function") {
            callback = params as AllCallback;
            params = [];
        }

        try {
            // biome-ignore lint: bun:sqlite's binding types are too narrow for the loosely-typed params Sequelize passes through
            callback?.(null, this.db.query(sql).all(normalizeParams(params) as any));
        } catch (err) {
            callback?.(err as Error, []);
        }
    }

    close(callback?: (err: Error | null) => void): void {
        try {
            this.db.close();
            callback?.(null);
        } catch (err) {
            callback?.(err as Error);
        }
    }
}

export const bunSqliteDriver = {
    OPEN_READWRITE,
    OPEN_CREATE,
    Database: BunSqliteConnection,
};
