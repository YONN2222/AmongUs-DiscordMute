import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe.each(backends)("AuditLogRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let actorId: string;
        let targetId: string;

        beforeEach(async () => {
            db = await openBackend(backend);
            actorId = uniqueId("actor");
            targetId = uniqueId("target");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("record round-trips details json", async () => {
            const details = { reason: "spam", leftGuildCount: 2, left: true, note: null };
            const entry = await db.audit.record(
                { actorId, action: "block.create", targetType: "user", targetId, details },
                5000,
            );

            expect(entry).toMatchObject({ actorId, action: "block.create", targetType: "user", targetId, details });
            const { rows } = await db.audit.list({ targetId, offset: 0, limit: 10 });
            expect(rows).toEqual([entry]);
        });

        it("record defaults to no target and empty details", async () => {
            const entry = await db.audit.record({ actorId, action: "dashboard.login" });

            expect(entry.targetType).toBeNull();
            expect(entry.targetId).toBeNull();
            expect(entry.details).toEqual({});
            expect((await db.audit.list({ actorId, offset: 0, limit: 10 })).rows).toEqual([entry]);
        });

        it("list filters and orders by createdAt desc then id", async () => {
            const first = await db.audit.record({ actorId, action: "guild.leave", targetId }, 1000);
            const second = await db.audit.record({ actorId, action: "block.create", targetId }, 3000);
            const tieA = await db.audit.record({ actorId, action: "block.remove", targetId }, 2000);
            const tieB = await db.audit.record({ actorId, action: "block.remove", targetId }, 2000);
            await db.audit.record({ actorId: uniqueId("actor"), action: "block.create" }, 4000);
            const [tieFirst, tieSecond] = [tieA, tieB].sort((a, b) => a.id.localeCompare(b.id));

            const all = await db.audit.list({ actorId, offset: 0, limit: 10 });
            expect(all.rows.map((row) => row.id)).toEqual([second.id, tieFirst.id, tieSecond.id, first.id]);
            expect(all.total).toBe(4);

            const byAction = await db.audit.list({ actorId, action: "block.remove", offset: 0, limit: 10 });
            expect(byAction.total).toBe(2);

            const byTarget = await db.audit.list({ targetId, offset: 1, limit: 2 });
            expect(byTarget.rows.map((row) => row.id)).toEqual([tieFirst.id, tieSecond.id]);
            expect(byTarget.total).toBe(4);
        });

        it("countSince counts entries from the given time on", async () => {
            const farFuture = 4_100_000_000_000;
            await db.audit.record({ actorId, action: "dashboard.login" }, farFuture - 1);
            await db.audit.record({ actorId, action: "dashboard.login" }, farFuture);
            await db.audit.record({ actorId, action: "dashboard.login" }, farFuture + 1);

            expect(await db.audit.countSince(farFuture)).toBe(2);
        });

        it("pruneOlderThan deletes only old rows", async () => {
            const old = await db.audit.record({ actorId, action: "dashboard.login" }, 1000);
            const recent = await db.audit.record({ actorId, action: "dashboard.login" }, 5000);

            expect(await db.audit.pruneOlderThan(3000)).toBeGreaterThanOrEqual(1);

            const { rows } = await db.audit.list({ actorId, offset: 0, limit: 10 });
            expect(rows.map((row) => row.id)).toEqual([recent.id]);
            expect(rows.map((row) => row.id)).not.toContain(old.id);
        });
    });
});
