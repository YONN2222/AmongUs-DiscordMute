import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import type { TrackedMessage } from "../../src/Data/Repositories/TrackedMessageRepository";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe.each(backends)("TrackedMessageRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let g1: string;
        let g2: string;

        const overview = (guildId: string, patch: Partial<TrackedMessage> = {}): TrackedMessage => ({
            guildId,
            kind: "link-overview",
            key: "",
            channelId: "c1",
            messageId: "m1",
            deleteAt: null,
            ...patch,
        });

        beforeEach(async () => {
            db = await openBackend(backend);
            g1 = uniqueId("g1");
            g2 = uniqueId("g2");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("round-trips a message and replaces it on upsert", async () => {
            await db.trackedMessages.upsert(overview(g1));
            expect(await db.trackedMessages.get(g1, "link-overview", "")).toEqual(overview(g1));

            await db.trackedMessages.upsert(overview(g1, { channelId: "c2", messageId: "m2", deleteAt: 5000 }));
            expect(await db.trackedMessages.get(g1, "link-overview", "")).toEqual(
                overview(g1, { channelId: "c2", messageId: "m2", deleteAt: 5000 }),
            );
        });

        it("keeps kinds, keys and guilds apart", async () => {
            await db.trackedMessages.upsert(overview(g1));
            await db.trackedMessages.upsert(overview(g1, { kind: "summary", key: "game-1", messageId: "m2" }));
            await db.trackedMessages.upsert(overview(g1, { kind: "summary", key: "game-2", messageId: "m3" }));
            await db.trackedMessages.upsert(overview(g2, { messageId: "m4" }));

            expect(await db.trackedMessages.get(g1, "status", "")).toBeNull();
            const summaries = await db.trackedMessages.listByGuilds([g1, g2], "summary");
            expect(summaries.map((m) => m.key).sort()).toEqual(["game-1", "game-2"]);
            const overviews = await db.trackedMessages.listByGuilds([g1, g2], "link-overview");
            expect(overviews.map((m) => m.messageId).sort()).toEqual(["m1", "m4"]);
            expect(await db.trackedMessages.listByGuilds([], "link-overview")).toEqual([]);
        });

        it("lists only rows that are due", async () => {
            await db.trackedMessages.upsert(overview(g1, { kind: "summary", key: "a", deleteAt: 1000 }));
            await db.trackedMessages.upsert(overview(g1, { kind: "summary", key: "b", deleteAt: 2000 }));
            await db.trackedMessages.upsert(overview(g1, { kind: "summary", key: "c", deleteAt: 3000 }));
            await db.trackedMessages.upsert(overview(g1));
            await db.trackedMessages.upsert(overview(g2, { kind: "summary", key: "d", deleteAt: 1 }));

            const due = await db.trackedMessages.listDue([g1], 2000);
            expect(due.map((m) => m.key).sort()).toEqual(["a", "b"]);
            expect(await db.trackedMessages.listDue([], 2000)).toEqual([]);
        });

        it("removes one message and deletes everything of a guild", async () => {
            await db.trackedMessages.upsert(overview(g1));
            await db.trackedMessages.upsert(overview(g1, { kind: "status" }));
            await db.trackedMessages.upsert(overview(g2));

            await db.trackedMessages.remove(g1, "link-overview", "");
            expect(await db.trackedMessages.get(g1, "link-overview", "")).toBeNull();
            expect(await db.trackedMessages.get(g1, "status", "")).not.toBeNull();

            await db.trackedMessages.deleteByGuild(g1);
            expect(await db.trackedMessages.get(g1, "status", "")).toBeNull();
            expect(await db.trackedMessages.get(g2, "link-overview", "")).not.toBeNull();
        });
    });
});
