import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import { AUDIT_RETENTION_MS } from "../../src/Data/Repositories/AuditLogRepository";
import { LEFT_GUILD_RETENTION_MS } from "../../src/Data/Repositories/HostedGuildRepository";
import { startHourlyCleanup } from "../../src/Gateway/HostedGateway";
import { logger } from "../../src/Logging/Logger";

const HOUR_MS = 60 * 60 * 1000;
const NOW = 500 * 24 * HOUR_MS;

function fakeDb(pruneOlderThan: () => Promise<number>, listLeftBefore: () => Promise<string[]> = async () => []) {
    const audit = { pruneOlderThan: vi.fn(pruneOlderThan), record: vi.fn(async () => ({})) };
    const hostedGuilds = { listLeftBefore: vi.fn(listLeftBefore), purgeGuild: vi.fn(async () => {}) };
    return { audit, hostedGuilds, db: { audit, hostedGuilds } as unknown as Pick<Database, "audit" | "hostedGuilds"> };
}

describe("startHourlyCleanup", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("prunes the audit log and purges left servers at start and then every hour", async () => {
        const { audit, hostedGuilds, db } = fakeDb(async () => 0);
        const stop = startHourlyCleanup(db, () => NOW);

        expect(audit.pruneOlderThan).toHaveBeenCalledWith(NOW - AUDIT_RETENTION_MS);
        expect(hostedGuilds.listLeftBefore).toHaveBeenCalledWith(NOW - LEFT_GUILD_RETENTION_MS);
        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(audit.pruneOlderThan).toHaveBeenCalledTimes(2);
        expect(hostedGuilds.listLeftBefore).toHaveBeenCalledTimes(2);

        stop();
        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(audit.pruneOlderThan).toHaveBeenCalledTimes(2);
    });

    it("logs failures and keeps going", async () => {
        const error = vi.spyOn(logger, "error").mockImplementation(() => {});
        const failing = async () => Promise.reject(new Error("db down"));
        const { db } = fakeDb(failing, failing);
        const stop = startHourlyCleanup(db, () => NOW);

        await vi.advanceTimersByTimeAsync(HOUR_MS);

        expect(error).toHaveBeenCalledTimes(4);
        stop();
    });
});
