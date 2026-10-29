import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdminHandlers } from "../../src/Admin/AdminHandlers";
import type { ClusterInfo } from "../../src/Admin/Contract";
import type { Database } from "../../src/Data/Database";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const HOUR_MS = 3600 * 1000;
const NOW = 100 * 24 * HOUR_MS;
const STARTED_AT = NOW - 90_000;

describe.each(backends)("admin handlers, read endpoints (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let sessionsByGuild: Map<string, number>;
        let clusters: ClusterInfo[];

        const handlers = () =>
            createAdminHandlers({
                db,
                plugins: {
                    sessionCount: () => [...sessionsByGuild.values()].reduce((sum, count) => sum + count, 0),
                    sessionsOfGuild: (guildId) => sessionsByGuild.get(guildId) ?? 0,
                    disconnectGuild: () => 0,
                },
                activeGames: async () => 4,
                clusterInfo: async () => clusters,
                router: new InMemoryClusterRouter(),
                version: "3.0.0",
                startedAt: STARTED_AT,
                now: () => NOW,
            });

        const addGuild = (
            guildId: string,
            name: string,
            ownerId: string,
            joinedAt: number,
            icon: string | null = null,
        ) => db.hostedGuilds.upsert({ guildId, name, icon, ownerId, memberCount: 10, joinedAt }, NOW);

        beforeEach(async () => {
            db = await openBackend(backend);
            sessionsByGuild = new Map();
            clusters = [{ id: 0, ok: true, guilds: 2, wsPingMs: 41 }];
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("guild list joins link counts, secret flag, block flags and plugin counts", async () => {
            const plain = uniqueId("plain");
            const rich = uniqueId("rich");
            const blockedGuild = uniqueId("blocked");
            const richOwner = uniqueId("owner");
            const blockedOwner = uniqueId("blockedowner");
            await addGuild(plain, "Plain", uniqueId("o"), 1000);
            await addGuild(rich, "Rich", richOwner, 2000, "icon123");
            await addGuild(blockedGuild, "Blocked", uniqueId("o"), 500);
            const ownerBlockedGuild = uniqueId("ownerblocked");
            await addGuild(ownerBlockedGuild, "Owner Blocked", blockedOwner, 100);
            await db.links.upsert(rich, "u1", "One");
            await db.links.upsert(rich, "u2", "Two");
            await db.links.upsert(plain, "u1", "One");
            await db.guildSecrets.rotate(rich, "system");
            await db.blocks.create({ type: "guild", targetId: blockedGuild, reason: "test", blockedBy: "system" });
            await db.blocks.create({ type: "user", targetId: blockedOwner, reason: "test", blockedBy: "system" });
            sessionsByGuild.set(rich, 2);

            const page = await handlers().listGuilds({ page: 1, limit: 25 });

            const mine = page.rows.filter((row) => row.guildId.startsWith("test-"));
            expect(mine.map((row) => row.guildId)).toEqual([rich, plain, blockedGuild, ownerBlockedGuild]);
            expect(mine[0]).toEqual({
                guildId: rich,
                name: "Rich",
                iconUrl: `https://cdn.discordapp.com/icons/${rich}/icon123.png?size=128`,
                ownerId: richOwner,
                memberCount: 10,
                joinedAt: 2000,
                botInstance: expect.any(String),
                linkedUsers: 2,
                connectedPlugins: 2,
                hasSecret: true,
                blocked: false,
                ownerBlocked: false,
            });
            expect(mine[1]).toMatchObject({ iconUrl: null, linkedUsers: 1, hasSecret: false, connectedPlugins: 0 });
            expect(mine[2]).toMatchObject({ blocked: true, ownerBlocked: false, linkedUsers: 0 });
            expect(mine[3]).toMatchObject({ blocked: false, ownerBlocked: true });
            expect(page.total).toBeGreaterThanOrEqual(4);
        });

        it("guild search treats % literally", async () => {
            const literal = uniqueId("literal");
            const other = uniqueId("other");
            await addGuild(literal, "100% Crew", uniqueId("o"), 1000);
            await addGuild(other, "100 Crew", uniqueId("o"), 2000);

            const page = await handlers().listGuilds({ page: 1, limit: 25, q: "%" });

            expect(page.rows.map((row) => row.guildId)).toEqual([literal]);
            expect(page.total).toBe(1);
        });

        it("guild list pages with the requested offset", async () => {
            const ids = [uniqueId("a"), uniqueId("b"), uniqueId("c")];
            for (const [index, guildId] of ids.entries())
                await addGuild(guildId, `Crew ${index}`, uniqueId("o"), index);

            const page = await handlers().listGuilds({ page: 2, limit: 1, q: "crew" });

            expect(page.rows.map((row) => row.guildId)).toEqual([ids[1]]);
            expect(page.total).toBe(3);
        });

        it("getGuild returns one summary", async () => {
            const guildId = uniqueId("one");
            await addGuild(guildId, "Solo", uniqueId("o"), 1000);

            expect(await handlers().getGuild(guildId)).toMatchObject({ guildId, name: "Solo" });
        });

        it("getGuild unknown is null", async () => {
            expect(await handlers().getGuild(uniqueId("missing"))).toBeNull();
        });

        it("block list and audit list return pages", async () => {
            const target = uniqueId("target");
            await db.blocks.create({ type: "guild", targetId: target, reason: "spam", blockedBy: "system" }, NOW);
            await db.audit.record({ actorId: "system", action: "block.create", targetType: "guild", targetId: target });

            const blocks = await handlers().listBlocks({ page: 1, limit: 25, q: target });
            const audit = await handlers().listAudit({ page: 1, limit: 25, targetId: target });

            expect(blocks.rows.map((block) => block.targetId)).toEqual([target]);
            expect(audit.rows.map((entry) => entry.action)).toEqual(["block.create"]);
        });

        it("health reports mode and version", async () => {
            expect(await handlers().health()).toEqual({ status: "ok", mode: "hosted", version: "3.0.0" });
        });

        it("overview counts guilds, users, blocks and audit entries of the last 24 h", async () => {
            const before = await handlers().overview();
            const guildId = uniqueId("g");
            const blockedUser = uniqueId("bu");
            await addGuild(guildId, "Counted", uniqueId("o"), 1000);
            await db.links.upsert(guildId, uniqueId("user"), "One");
            await db.blocks.create({ type: "user", targetId: blockedUser, reason: "t", blockedBy: "system" });
            await db.blocks.create({ type: "guild", targetId: uniqueId("bg"), reason: "t", blockedBy: "system" });
            const entry = {
                actorId: "system",
                action: "guild.auto-leave",
                targetType: "guild",
                targetId: guildId,
            } as const;
            await db.audit.record(entry, NOW - HOUR_MS);
            await db.audit.record(entry, NOW - 25 * HOUR_MS);
            sessionsByGuild.set(guildId, 3);

            const overview = await handlers().overview();

            expect(overview).toMatchObject({
                mode: "hosted",
                version: "3.0.0",
                uptimeSeconds: 90,
                activeGames: 4,
                connectedPlugins: 3,
                clusters,
            });
            expect(overview.guilds - before.guilds).toBe(1);
            expect(overview.linkedUsers - before.linkedUsers).toBe(1);
            expect(overview.blocks.user - before.blocks.user).toBe(1);
            expect(overview.blocks.guild - before.blocks.guild).toBe(1);
            expect(overview.auditEntries24h - before.auditEntries24h).toBe(1);
        });
    });
});
