import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdminHandlers } from "../../src/Admin/AdminHandlers";
import type { Block } from "../../src/Admin/Contract";
import type { Database } from "../../src/Data/Database";
import { CLOSE_BLOCKED, CLOSE_BOT_LEFT } from "../../src/Protocol/PluginProtocol";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import type { RouterReply } from "../../src/Routing/Messages";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const START = 1_000_000;
const BLOCK_BUDGET_MS = 30_000;

describe.each(backends)("admin handlers, actions (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let router: InMemoryClusterRouter;
        let clock: number;
        let events: string[];
        let disconnects: { guildId: string; code: number; reason: string }[];
        let admin: string;

        const handlers = () =>
            createAdminHandlers({
                db,
                plugins: {
                    sessionCount: () => 0,
                    sessionsOfGuild: () => 0,
                    disconnectGuild: (guildId, code, reason) => {
                        events.push(`disconnect:${guildId}`);
                        disconnects.push({ guildId, code, reason });
                        return 1;
                    },
                },
                activeGames: async () => 0,
                clusterInfo: async () => [],
                router,
                version: "3.0.0",
                startedAt: START,
                now: () => clock,
            });

        const addGuild = (guildId: string, ownerId: string) =>
            db.hostedGuilds.upsert(
                { guildId, name: "Crew", icon: null, ownerId, memberCount: 3, joinedAt: START },
                START,
            );

        const leavesWith = (guildId: string, reply: RouterReply = { ok: true }) =>
            router.register(guildId, async () => {
                events.push(`leave:${guildId}`);
                return reply;
            });

        const blocked = (result: Block | "conflict"): Block => {
            if (result === "conflict") throw new Error("expected a block");
            return result;
        };

        const auditOf = async (targetId: string) => (await db.audit.list({ targetId, offset: 0, limit: 10 })).rows;

        beforeEach(async () => {
            db = await openBackend(backend);
            router = new InMemoryClusterRouter();
            clock = START;
            events = [];
            disconnects = [];
            admin = uniqueId("admin");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it('guild block leaves the guild and stores "Left the server"', async () => {
            const guildId = uniqueId("guild");
            await addGuild(guildId, uniqueId("owner"));
            leavesWith(guildId);

            const block = blocked(
                await handlers().createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: admin }),
            );

            expect(block).toMatchObject({
                type: "guild",
                targetId: guildId,
                reason: "spam",
                blockedBy: admin,
                summary: "Left the server",
                leftGuild: true,
                leftGuildCount: 1,
            });
            expect(router.sent).toEqual([{ guildId, req: { kind: "leave-guild", guildId, reason: "guild-blocked" } }]);
            expect(await db.blocks.get("guild", guildId)).toEqual(block);
            expect(await auditOf(guildId)).toMatchObject([
                {
                    actorId: admin,
                    action: "block.create",
                    targetType: "guild",
                    details: { reason: "spam", leftGuildCount: 1 },
                },
            ]);
        });

        it("the plugin is disconnected as blocked before the bot leaves", async () => {
            const guildId = uniqueId("guild");
            await addGuild(guildId, uniqueId("owner"));
            leavesWith(guildId);

            await handlers().createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: admin });

            expect(events).toEqual([`disconnect:${guildId}`, `leave:${guildId}`]);
            expect(disconnects).toEqual([{ guildId, code: CLOSE_BLOCKED, reason: "Server blocked" }]);
        });

        it('guild block on an unknown guild stores "Bot was not in the server"', async () => {
            const guildId = uniqueId("unknown");

            const block = blocked(
                await handlers().createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: admin }),
            );

            expect(block).toMatchObject({ summary: "Bot was not in the server", leftGuild: false, leftGuildCount: 0 });
            expect(router.sent).toEqual([]);
            expect(disconnects).toEqual([]);
        });

        it("a failed guild leave is stored in the summary", async () => {
            const guildId = uniqueId("guild");
            await addGuild(guildId, uniqueId("owner"));
            leavesWith(guildId, { ok: false, error: "cluster starting" });

            const block = blocked(
                await handlers().createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: admin }),
            );

            expect(block).toMatchObject({
                summary: "Leaving the server failed: cluster starting",
                leftGuild: false,
                leftGuildCount: 0,
            });
        });

        it("user block leaves every owned guild and counts them", async () => {
            const owner = uniqueId("owner");
            const first = uniqueId("guild");
            const second = uniqueId("guild");
            const foreign = uniqueId("guild");
            await addGuild(first, owner);
            await addGuild(second, owner);
            await addGuild(foreign, uniqueId("owner"));
            for (const guildId of [first, second, foreign]) leavesWith(guildId);

            const block = blocked(
                await handlers().createBlock({ type: "user", targetId: owner, reason: "abuse", actorId: admin }),
            );

            expect(block).toMatchObject({
                type: "user",
                summary: "Left 2 server(s) owned by this user",
                leftGuild: true,
                leftGuildCount: 2,
            });
            expect(router.sent.map((entry) => entry.guildId).sort()).toEqual([first, second].sort());
            expect(router.sent.map((entry) => entry.req)).toEqual(
                expect.arrayContaining([
                    { kind: "leave-guild", guildId: first, reason: "owner-blocked" },
                    { kind: "leave-guild", guildId: second, reason: "owner-blocked" },
                ]),
            );
            expect(await auditOf(owner)).toMatchObject([
                { action: "block.create", targetType: "user", details: { reason: "abuse", leftGuildCount: 2 } },
            ]);
        });

        it('user block without servers stores "No servers owned by this user"', async () => {
            const block = blocked(
                await handlers().createBlock({
                    type: "user",
                    targetId: uniqueId("owner"),
                    reason: "abuse",
                    actorId: admin,
                }),
            );

            expect(block).toMatchObject({
                summary: "No servers owned by this user",
                leftGuild: false,
                leftGuildCount: 0,
            });
        });

        it('partial failure summary "Left 1 of 2 server(s) owned by this user"', async () => {
            const owner = uniqueId("owner");
            const good = uniqueId("guild");
            const bad = uniqueId("guild");
            await addGuild(good, owner);
            await addGuild(bad, owner);
            leavesWith(good);
            leavesWith(bad, { ok: false, error: "not-in-guild" });

            const block = blocked(
                await handlers().createBlock({ type: "user", targetId: owner, reason: "abuse", actorId: admin }),
            );

            expect(block).toMatchObject({
                summary: "Left 1 of 2 server(s) owned by this user",
                leftGuild: true,
                leftGuildCount: 1,
            });
        });

        it("guilds left after the 30 s budget count as failed", async () => {
            const owner = uniqueId("owner");
            const first = uniqueId("guild");
            const second = uniqueId("guild");
            await addGuild(first, owner);
            await addGuild(second, owner);
            for (const guildId of [first, second]) {
                router.register(guildId, async () => {
                    clock += BLOCK_BUDGET_MS;
                    return { ok: true };
                });
            }

            const block = blocked(
                await handlers().createBlock({ type: "user", targetId: owner, reason: "abuse", actorId: admin }),
            );

            expect(block).toMatchObject({ summary: "Left 1 of 2 server(s) owned by this user", leftGuildCount: 1 });
            expect(router.sent).toHaveLength(1);
        });

        it("duplicate block is a conflict and leaves nothing", async () => {
            const guildId = uniqueId("guild");
            await addGuild(guildId, uniqueId("owner"));
            leavesWith(guildId);
            await handlers().createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: admin });
            router.sent.length = 0;

            const second = await handlers().createBlock({
                type: "guild",
                targetId: guildId,
                reason: "again",
                actorId: admin,
            });

            expect(second).toBe("conflict");
            expect(router.sent).toEqual([]);
            expect(await auditOf(guildId)).toHaveLength(1);
        });

        it("remove block audits only when something was removed", async () => {
            const guildId = uniqueId("guild");
            await db.blocks.create({ type: "guild", targetId: guildId, reason: "spam", blockedBy: "system" });

            const removed = await handlers().removeBlock("guild", guildId, { actorId: admin });
            const again = await handlers().removeBlock("guild", guildId, { actorId: admin });

            expect(removed).toBe(true);
            expect(again).toBe(false);
            expect(await db.blocks.isBlocked("guild", guildId)).toBe(false);
            expect(await auditOf(guildId)).toMatchObject([
                { actorId: admin, action: "block.remove", targetType: "guild" },
            ]);
        });

        it("admin leave writes guild.leave with the reason", async () => {
            const guildId = uniqueId("guild");
            await addGuild(guildId, uniqueId("owner"));
            leavesWith(guildId);

            const result = await handlers().leaveGuild(guildId, { actorId: admin, reason: "requested by owner" });

            expect(result).toEqual({ left: true });
            expect(router.sent).toEqual([{ guildId, req: { kind: "leave-guild", guildId, reason: "admin" } }]);
            expect(events).toEqual([`disconnect:${guildId}`, `leave:${guildId}`]);
            expect(disconnects).toEqual([{ guildId, code: CLOSE_BOT_LEFT, reason: "The bot left this server" }]);
            expect(await auditOf(guildId)).toMatchObject([
                {
                    actorId: admin,
                    action: "guild.leave",
                    targetType: "guild",
                    details: { reason: "requested by owner", left: true },
                },
            ]);
        });

        it("admin leave reports a failed leave and still audits it", async () => {
            const guildId = uniqueId("guild");
            await addGuild(guildId, uniqueId("owner"));
            leavesWith(guildId, { ok: false, error: "not-in-guild" });

            const result = await handlers().leaveGuild(guildId, { actorId: admin, reason: "cleanup" });

            expect(result).toEqual({ left: false });
            expect(await auditOf(guildId)).toMatchObject([{ action: "guild.leave", details: { left: false } }]);
        });

        it("admin leave of an unknown guild is null and writes nothing", async () => {
            const guildId = uniqueId("unknown");

            expect(await handlers().leaveGuild(guildId, { actorId: admin, reason: "cleanup" })).toBeNull();
            expect(router.sent).toEqual([]);
            expect(await auditOf(guildId)).toEqual([]);
        });

        describe("purge", () => {
            const purgeAudits = async (guildId: string) =>
                (await db.audit.list({ targetId: guildId, action: "guild.purge", offset: 0, limit: 10 })).rows;

            it("is refused while the bot is still in the server and deletes nothing", async () => {
                const guildId = uniqueId("guild");
                await addGuild(guildId, uniqueId("owner"));

                expect(await handlers().purgeGuild(guildId, { actorId: admin })).toBe("in-guild");
                expect(await db.hostedGuilds.get(guildId)).not.toBeNull();
                expect(await purgeAudits(guildId)).toEqual([]);
            });

            it("deletes a left server at once and audits the operator once", async () => {
                const guildId = uniqueId("guild");
                await addGuild(guildId, uniqueId("owner"));
                await db.links.upsert(guildId, "u1", "Crew");
                await db.hostedGuilds.markLeft(guildId, START);

                expect(await handlers().purgeGuild(guildId, { actorId: admin })).toBe("purged");

                expect(await db.hostedGuilds.get(guildId)).toBeNull();
                expect(await db.links.findByAccountName(guildId, "Crew")).toEqual([]);
                expect(await purgeAudits(guildId)).toMatchObject([
                    { actorId: admin, action: "guild.purge", targetType: "guild", targetId: guildId },
                ]);
            });

            it("an unknown server is null", async () => {
                expect(await handlers().purgeGuild(uniqueId("unknown"), { actorId: admin })).toBeNull();
            });
        });

        it('guild block of a server the bot already left stores "Bot was not in the server"', async () => {
            const guildId = uniqueId("guild");
            await addGuild(guildId, uniqueId("owner"));
            await db.hostedGuilds.markLeft(guildId, START);

            const block = blocked(
                await handlers().createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: admin }),
            );

            expect(block).toMatchObject({ summary: "Bot was not in the server", leftGuildCount: 0 });
            expect(router.sent).toEqual([]);
        });

        it("dashboard audit stores the login", async () => {
            const entry = await handlers().recordDashboardAudit({
                actorId: admin,
                action: "dashboard.login",
                details: { ip: "10.0.0.1" },
            });

            expect(entry).toMatchObject({
                actorId: admin,
                action: "dashboard.login",
                targetType: null,
                targetId: null,
                details: { ip: "10.0.0.1" },
            });
            const stored = await db.audit.list({ actorId: admin, offset: 0, limit: 10 });
            expect(stored.rows).toEqual([entry]);
        });

        it("dashboard audit without details stores an empty object", async () => {
            const entry = await handlers().recordDashboardAudit({ actorId: admin, action: "dashboard.logout" });

            expect(entry.details).toEqual({});
        });
    });
});
