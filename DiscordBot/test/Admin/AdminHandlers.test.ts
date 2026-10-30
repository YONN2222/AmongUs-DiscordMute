import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdminHandlers } from "../../src/Admin/AdminHandlers";
import type { ClusterInfo, PluginSessionInfo } from "../../src/Admin/Contract";
import type { Database } from "../../src/Data/Database";
import { LEFT_GUILD_RETENTION_MS } from "../../src/Data/Repositories/HostedGuildRepository";
import type { PendingLink } from "../../src/Data/Repositories/PendingLinkRepository";
import { hashSecret } from "../../src/Hosted/GuildSecrets";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const HOUR_MS = 3600 * 1000;
const NOW = 100 * 24 * HOUR_MS;
const STARTED_AT = NOW - 90_000;

function pendingLink(guildId: string, discordId: string, expiresAt: number): PendingLink {
    const code = discordId.slice(-12);
    return { guildId, discordId, phrase: `phrase ${code}`, quickChatCode: code, quickChatIds: [1, 2], expiresAt };
}

describe.each(backends)("admin handlers, read endpoints (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let sessionsByGuild: Map<string, number>;
        let sessionInfoByGuild: Map<string, PluginSessionInfo[]>;
        let clusters: ClusterInfo[];

        const handlers = () =>
            createAdminHandlers({
                db,
                plugins: {
                    sessionCount: () => [...sessionsByGuild.values()].reduce((sum, count) => sum + count, 0),
                    sessionsOfGuild: (guildId) => sessionsByGuild.get(guildId) ?? 0,
                    sessionsInfo: (guildId) => sessionInfoByGuild.get(guildId) ?? [],
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
            sessionInfoByGuild = new Map();
            clusters = [
                {
                    id: 0,
                    ok: true,
                    status: "running",
                    shardIds: [0],
                    startedAt: STARTED_AT,
                    guilds: 2,
                    wsPingMs: 41,
                    uptimeSeconds: 90,
                    memoryRssBytes: 1024,
                    shards: [{ id: 0, status: 0, pingMs: 41, guilds: 2, lastPingAt: NOW }],
                },
            ];
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
                leftAt: null,
                purgeAt: null,
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

        it("a left guild shows when it left and when its data is deleted", async () => {
            const guildId = uniqueId("left");
            await addGuild(guildId, "Gone", uniqueId("o"), 1000);
            await db.hostedGuilds.markLeft(guildId, NOW);

            expect(await handlers().getGuild(guildId)).toMatchObject({
                leftAt: NOW,
                purgeAt: NOW + LEFT_GUILD_RETENTION_MS,
            });
        });

        it("guild detail adds settings, secret metadata, blocks, open link requests and plugin sessions", async () => {
            const guildId = uniqueId("detail");
            const ownerId = uniqueId("owner");
            await addGuild(guildId, "Detailed", ownerId, 1000);
            await db.settings.save(guildId, { ...DEFAULT_SETTINGS, language: "de", ghostChat: true });
            await db.guildSecrets.rotate(guildId, "123456789012345678", NOW - HOUR_MS);
            await db.blocks.create({ type: "user", targetId: ownerId, reason: "spam", blockedBy: "system" }, NOW);
            await db.pendingLinks.create(pendingLink(guildId, uniqueId("u"), NOW + HOUR_MS));
            await db.pendingLinks.create(pendingLink(guildId, uniqueId("u"), NOW - HOUR_MS));
            const session = {
                sessionId: "session-1",
                connectedAt: NOW - 60_000,
                pluginVersion: "3.0.0",
                gameVersion: "2026.9.29",
                protocolVersion: 3,
            };
            sessionInfoByGuild.set(guildId, [session]);

            const detail = await handlers().getGuildDetail(guildId);

            expect(detail).toMatchObject({
                guildId,
                name: "Detailed",
                ownerBlocked: true,
                settings: { ...DEFAULT_SETTINGS, language: "de", ghostChat: true },
                secret: { createdAt: NOW - HOUR_MS, createdBy: "123456789012345678" },
                block: null,
                ownerBlock: { type: "user", targetId: ownerId, reason: "spam" },
                pendingLinks: 1,
                sessions: [session],
            });
        });

        it("guild detail never contains the secret, its hash, an interaction token or an address", async () => {
            const guildId = uniqueId("private");
            const discordId = uniqueId("u");
            await addGuild(guildId, "Private", uniqueId("owner"), 1000);
            const { secret } = await db.guildSecrets.rotate(guildId, "123456789012345678");
            await db.pendingLinks.create(pendingLink(guildId, discordId, NOW + HOUR_MS));
            await db.pendingLinks.attachInteraction(guildId, discordId, "app-id", "interaction-token-value");

            const serialized = JSON.stringify(await handlers().getGuildDetail(guildId));

            expect(serialized).not.toContain(secret);
            expect(serialized).not.toContain(hashSecret(secret));
            expect(serialized).not.toContain("interaction-token-value");
            expect(serialized).not.toMatch(/secret_?hash|interaction_?token|"phrase"|quickChat/i);
            expect(serialized).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
        });

        it("guild detail of an unknown guild is null", async () => {
            expect(await handlers().getGuildDetail(uniqueId("missing"))).toBeNull();
        });

        it("guild links come in pages with their total and the link time in milliseconds", async () => {
            const guildId = uniqueId("links");
            await addGuild(guildId, "Linked", uniqueId("owner"), 1000);
            await db.links.upsert(guildId, "u1", "Alpha");
            await db.links.upsert(guildId, "u2", "Bravo");
            await db.links.setFriendCode(guildId, "u2", "bravo#1234");
            await db.links.upsert(guildId, "u3", "Charlie");

            const page = await handlers().listGuildLinks(guildId, { page: 2, limit: 1 });

            expect(page).toEqual({
                rows: [
                    { discordId: "u2", accountName: "Bravo", friendCode: "bravo#1234", linkedAt: expect.any(Number) },
                ],
                total: 3,
            });
            expect(Number.isNaN(page?.rows[0]?.linkedAt)).toBe(false);
        });

        it("guild links of an unknown guild are null", async () => {
            expect(await handlers().listGuildLinks(uniqueId("missing"), { page: 1, limit: 25 })).toBeNull();
        });

        it("user lookup joins the user's links, owned servers and block", async () => {
            const userId = uniqueId("user");
            const linkedGuild = uniqueId("linked");
            const ownedGuild = uniqueId("owned");
            await addGuild(linkedGuild, "Linked Crew", uniqueId("owner"), 1000);
            await addGuild(ownedGuild, "Own Crew", userId, 2000);
            await db.links.upsert(linkedGuild, userId, "Red");
            await db.blocks.create({ type: "user", targetId: userId, reason: "spam", blockedBy: "system" }, NOW);

            const user = await handlers().getUser(userId);

            expect(user).toMatchObject({
                userId,
                links: [
                    {
                        guildId: linkedGuild,
                        guildName: "Linked Crew",
                        accountName: "Red",
                        friendCode: null,
                        linkedAt: expect.any(Number),
                    },
                ],
                ownedGuilds: [{ guildId: ownedGuild, name: "Own Crew", ownerBlocked: true }],
                block: { type: "user", targetId: userId, reason: "spam" },
            });
        });

        it("user lookup finds a user by a block alone and is null when nothing is stored", async () => {
            const blocked = uniqueId("blocked");
            await db.blocks.create({ type: "user", targetId: blocked, reason: "spam", blockedBy: "system" }, NOW);

            expect(await handlers().getUser(blocked)).toMatchObject({ links: [], ownedGuilds: [] });
            expect(await handlers().getUser(uniqueId("unknown"))).toBeNull();
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

        it("lists the clusters and finds one by id", async () => {
            expect(await handlers().listClusters()).toEqual(clusters);
            expect(await handlers().getCluster(0)).toEqual(clusters[0]);
            expect(await handlers().getCluster(5)).toBeNull();
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
