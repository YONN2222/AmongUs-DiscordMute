import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_RETENTION_MS } from "../../src/Data/Repositories/AuditLogRepository";
import { startAuditPrune } from "../../src/Gateway/HostedGateway";
import { logger } from "../../src/Logging/Logger";

const HOUR_MS = 60 * 60 * 1000;
const NOW = 500 * 24 * HOUR_MS;

describe("startAuditPrune", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("prunes past the retention at start and then every hour", async () => {
        const audit = { pruneOlderThan: vi.fn(async () => 0) };
        const stop = startAuditPrune(audit, () => NOW);

        expect(audit.pruneOlderThan).toHaveBeenCalledWith(NOW - AUDIT_RETENTION_MS);
        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(audit.pruneOlderThan).toHaveBeenCalledTimes(2);

        stop();
        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(audit.pruneOlderThan).toHaveBeenCalledTimes(2);
    });

    it("logs a failed prune and keeps going", async () => {
        const error = vi.spyOn(logger, "error").mockImplementation(() => {});
        const audit = { pruneOlderThan: vi.fn(async () => Promise.reject(new Error("db down"))) };
        const stop = startAuditPrune(audit, () => NOW);

        await vi.advanceTimersByTimeAsync(HOUR_MS);

        expect(error).toHaveBeenCalledTimes(2);
        stop();
    });
});
