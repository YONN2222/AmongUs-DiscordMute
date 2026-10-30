import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../../src/Data/Database";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../../Helpers/TestDatabase";

describe.each(backends)("BlockRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let targetId: string;

        const newBlock = (overrides: Partial<Parameters<Database["blocks"]["create"]>[0]> = {}) => ({
            type: "user" as const,
            targetId,
            reason: "spam",
            blockedBy: uniqueId("admin"),
            ...overrides,
        });

        beforeEach(async () => {
            db = await openBackend(backend);
            targetId = uniqueId("target");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("create stores a block with an empty outcome", async () => {
            const block = await db.blocks.create(newBlock(), 1234);

            expect(block).toMatchObject({
                type: "user",
                targetId,
                reason: "spam",
                createdAt: 1234,
                summary: "",
                leftGuild: false,
                leftGuildCount: 0,
            });
            expect(await db.blocks.get("user", targetId)).toEqual(block);
        });

        it("create returns null for a duplicate block", async () => {
            expect(await db.blocks.create(newBlock())).not.toBeNull();
            expect(await db.blocks.create(newBlock({ reason: "again" }))).toBeNull();
            expect((await db.blocks.get("user", targetId))?.reason).toBe("spam");
        });

        it("the same id can be blocked as user and as guild", async () => {
            expect(await db.blocks.create(newBlock({ type: "user" }))).not.toBeNull();
            expect(await db.blocks.create(newBlock({ type: "guild" }))).not.toBeNull();
        });

        it("finish stores summary and leftGuild", async () => {
            const created = await db.blocks.create(newBlock({ type: "guild" }));
            const finished = await db.blocks.finish(created?.id as string, {
                summary: "Left the server",
                leftGuild: true,
                leftGuildCount: 1,
            });

            expect(finished).toMatchObject({ summary: "Left the server", leftGuild: true, leftGuildCount: 1 });
            expect(await db.blocks.get("guild", targetId)).toEqual(finished);
        });

        it("finish rejects an unknown block", async () => {
            await expect(
                db.blocks.finish(uniqueId("missing"), { summary: "", leftGuild: false, leftGuildCount: 0 }),
            ).rejects.toThrow();
        });

        it("isBlocked after create and not after remove", async () => {
            expect(await db.blocks.isBlocked("user", targetId)).toBe(false);
            await db.blocks.create(newBlock());
            expect(await db.blocks.isBlocked("user", targetId)).toBe(true);
            expect(await db.blocks.isBlocked("guild", targetId)).toBe(false);

            expect(await db.blocks.remove("user", targetId)).toBe(true);
            expect(await db.blocks.isBlocked("user", targetId)).toBe(false);
            expect(await db.blocks.remove("user", targetId)).toBe(false);
        });

        it("list filters by type and pages newest first", async () => {
            const farFuture = 4_000_000_000_000;
            const ids = [uniqueId("target"), uniqueId("target"), uniqueId("target")];
            for (const [index, id] of ids.entries()) {
                await db.blocks.create(newBlock({ targetId: id, type: "guild" }), farFuture + index);
            }
            await db.blocks.create(newBlock({ type: "user" }), farFuture + 10);

            const guilds = await db.blocks.list({ type: "guild", offset: 0, limit: 2 });
            expect(guilds.rows.map((block) => block.targetId)).toEqual([ids[2], ids[1]]);
            expect(guilds.total).toBeGreaterThanOrEqual(3);

            const second = await db.blocks.list({ type: "guild", offset: 2, limit: 2 });
            expect(second.rows[0].targetId).toBe(ids[0]);

            const users = await db.blocks.list({ type: "user", targetId, offset: 0, limit: 10 });
            expect(users.rows.map((block) => block.targetId)).toEqual([targetId]);
            expect(users.total).toBe(1);
        });

        it("counts per type", async () => {
            const before = await db.blocks.counts();
            await db.blocks.create(newBlock({ type: "user" }));
            await db.blocks.create(newBlock({ type: "guild" }));
            await db.blocks.create(newBlock({ type: "guild", targetId: uniqueId("target") }));

            expect(await db.blocks.counts()).toEqual({ user: before.user + 1, guild: before.guild + 2 });
        });

        it("blockedAmong", async () => {
            const other = uniqueId("target");
            await db.blocks.create(newBlock({ type: "user" }));
            await db.blocks.create(newBlock({ type: "guild", targetId: other }));

            expect(await db.blocks.blockedAmong("user", [targetId, other])).toEqual(new Set([targetId]));
            expect(await db.blocks.blockedAmong("guild", [targetId, other])).toEqual(new Set([other]));
            expect(await db.blocks.blockedAmong("user", [])).toEqual(new Set());
        });
    });
});
