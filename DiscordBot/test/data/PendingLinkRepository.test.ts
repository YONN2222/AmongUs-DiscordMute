import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/database";
import type { PendingLinkModel } from "../../src/Data/models/PendingLinkModel";
import { createPendingLinkRepository, type PendingLink } from "../../src/Data/repositories/PendingLinkRepository";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../helpers/testDatabase";

describe("createPendingLinkRepository", () => {
    it("refuses a model that was never initialised", () => {
        expect(() => createPendingLinkRepository({} as typeof PendingLinkModel)).toThrow(/not initialised/);
    });
});

describe.each(backends)("PendingLinkRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;
        const now = 1_000_000;

        function pending(overrides: Partial<PendingLink> = {}): PendingLink {
            return {
                guildId,
                discordId: "u1",
                phrase: uniqueId("phrase"),
                quickChatCode: uniqueId("qc"),
                quickChatIds: [3, 7],
                expiresAt: now + 60_000,
                ...overrides,
            };
        }

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("g");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("create then getActive round-trips quick chat ids and expiry", async () => {
            const p = pending();
            await db.pendingLinks.create(p);
            expect(await db.pendingLinks.getActive(guildId, "u1", now)).toEqual(p);
        });

        it("getActive ignores expired rows", async () => {
            await db.pendingLinks.create(pending({ expiresAt: now - 1 }));
            expect(await db.pendingLinks.getActive(guildId, "u1", now)).toBeNull();
        });

        it("consumeByCode matches text code", async () => {
            const p = pending();
            await db.pendingLinks.create(p);
            expect(await db.pendingLinks.consumeByCode(p.phrase, now)).toEqual(p);
            expect(await db.pendingLinks.getActive(guildId, "u1", now)).toBeNull();
        });

        it("consumeByCode matches quick chat code", async () => {
            const p = pending();
            await db.pendingLinks.create(p);
            expect(await db.pendingLinks.consumeByCode(p.quickChatCode, now)).toEqual(p);
        });

        it("consumeByCode ignores expired", async () => {
            const p = pending({ expiresAt: now - 1 });
            await db.pendingLinks.create(p);
            expect(await db.pendingLinks.consumeByCode(p.phrase, now)).toBeNull();
        });

        it("a code can be consumed only once", async () => {
            const p = pending();
            await db.pendingLinks.create(p);
            const results = await Promise.all([
                db.pendingLinks.consumeByCode(p.phrase, now),
                db.pendingLinks.consumeByCode(p.phrase, now),
            ]);
            expect(results.filter((r) => r !== null)).toHaveLength(1);
        });

        it("create replaces previous pending link of same user", async () => {
            const first = pending();
            const second = pending();
            await db.pendingLinks.create(first);
            await db.pendingLinks.create(second);
            expect(await db.pendingLinks.consumeByCode(first.phrase, now)).toBeNull();
            expect(await db.pendingLinks.consumeByCode(second.phrase, now)).toEqual(second);
        });

        it("attachInteraction stores the interaction data", async () => {
            const p = pending();
            await db.pendingLinks.create(p);
            await db.pendingLinks.attachInteraction(guildId, "u1", "app", "token");
            expect(await db.pendingLinks.consumeByCode(p.phrase, now)).toEqual({
                ...p,
                applicationId: "app",
                interactionToken: "token",
            });
        });

        it("stores interaction data as unbounded text", async () => {
            const columns = await db.sequelize.getQueryInterface().describeTable("pending_links");
            expect(columns.application_id?.type).toBe("TEXT");
            expect(columns.interaction_token?.type).toBe("TEXT");

            const p = pending();
            const longToken = "t".repeat(1000);
            await db.pendingLinks.create(p);
            await db.pendingLinks.attachInteraction(guildId, "u1", "app", longToken);
            expect((await db.pendingLinks.consumeByCode(p.phrase, now))?.interactionToken).toBe(longToken);
        });

        it("deleteExpired removes only expired rows", async () => {
            await db.pendingLinks.create(pending({ discordId: "old", expiresAt: now - 1 }));
            await db.pendingLinks.create(pending({ discordId: "fresh" }));
            expect(await db.pendingLinks.deleteExpired(now)).toBeGreaterThanOrEqual(1);
            expect(await db.pendingLinks.getActive(guildId, "fresh", now)).not.toBeNull();
        });
    });
});
