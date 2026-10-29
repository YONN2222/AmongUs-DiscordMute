import { randomInt } from "node:crypto";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminHandlers } from "../../src/Admin/AdminHandlers";
import { createAdminServer } from "../../src/Admin/AdminServer";
import { ADMIN_API_PREFIX } from "../../src/Admin/Contract";
import { createClusterRequestHandler } from "../../src/Cluster/ClusterRequestHandler";
import type { Database } from "../../src/Data/Database";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { GuildLifecycle, type GuildPort } from "../../src/Hosted/GuildLifecycle";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { backendAvailable, backends, openBackend } from "../Helpers/TestDatabase";

const TOKEN = "e2e-admin-token-".repeat(3);
const SNOWFLAKE_DIGITS = 18;

/** The admin API only accepts Discord ids, so these tests clean up their own rows instead of the test- prefix. */
function snowflake(): string {
    return Array.from({ length: SNOWFLAKE_DIGITS }, (_, i) => (i === 0 ? randomInt(1, 10) : randomInt(10))).join("");
}

function listen(server: Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            resolve(typeof address === "object" && address ? address.port : 0);
        });
    });
}

describe.each(backends)("admin API block through the cluster (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let server: Server;
        let baseUrl: string;
        let guildId: string;
        let ownerId: string;
        let operatorId: string;

        /** Leaves like Discord does: the leave is followed by a guild delete event for the same guild. */
        function discordPort(lifecycle: () => GuildLifecycle): GuildPort {
            return {
                leave: async (id) => {
                    await lifecycle().onGuildDelete(id);
                    return true;
                },
                cachedGuilds: () => [],
                cachedGuildIds: () => [],
                ownsGuild: () => true,
                fetchMemberGuildIds: async () => new Set(),
            };
        }

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = snowflake();
            ownerId = snowflake();
            operatorId = snowflake();
            await db.hostedGuilds.upsert(
                { guildId, name: "Crew", icon: null, ownerId, memberCount: 5, joinedAt: 1000 },
                1000,
            );

            const blocks = new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds });
            const lifecycle: GuildLifecycle = new GuildLifecycle({
                port: discordPort(() => lifecycle),
                hostedGuilds: db.hostedGuilds,
                blocks,
                audit: db.audit,
                games: { end: async () => {}, reopen: () => {}, forget: () => {}, recover: async () => {} },
                disconnectBlocked: async () => {},
                disconnectRemoved: async () => {},
            });
            const router = new InMemoryClusterRouter();
            router.register(
                guildId,
                createClusterRequestHandler({
                    mute: {
                        handleGameEvent: vi.fn(),
                        endSession: vi.fn(),
                        hasEnded: () => false,
                        isRemoved: () => false,
                    },
                    updateLinkReply: async () => true,
                    isReady: () => true,
                    events: { emit: () => {} },
                    links: db.links,
                    settings: { get: async () => DEFAULT_SETTINGS },
                    lifecycle,
                }),
            );
            const handlers = createAdminHandlers({
                db,
                plugins: { sessionCount: () => 0, sessionsOfGuild: () => 0, disconnectGuild: () => 1 },
                activeGames: async () => 0,
                clusterInfo: async () => [],
                router,
                version: "3.0.0",
                startedAt: 0,
            });
            server = createAdminServer({ token: TOKEN, handlers });
            baseUrl = `http://127.0.0.1:${await listen(server)}${ADMIN_API_PREFIX}`;
        });

        afterEach(async () => {
            await new Promise((resolve) => server.close(resolve));
            for (const id of [guildId, ownerId]) {
                await db.sequelize.query("DELETE FROM blocks WHERE target_id = ?", { replacements: [id] });
                await db.sequelize.query("DELETE FROM audit_log WHERE target_id = ?", { replacements: [id] });
            }
            await db.sequelize.query("DELETE FROM audit_log WHERE actor_id = ?", { replacements: [operatorId] });
            await db.hostedGuilds.purgeGuild(guildId);
            await db.close();
        });

        function block(type: "guild" | "user", targetId: string): Promise<Response> {
            return fetch(`${baseUrl}/blocks`, {
                method: "POST",
                headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ type, targetId, reason: "spam", actorId: operatorId }),
            });
        }

        async function auditRowsAbout(...targetIds: string[]) {
            const rows = [];
            for (const targetId of targetIds) {
                rows.push(...(await db.audit.list({ targetId, offset: 0, limit: 50 })).rows);
            }
            return rows;
        }

        it("a guild block writes exactly one audit row, with the operator as actor", async () => {
            const response = await block("guild", guildId);

            expect(response.status).toBe(201);
            expect(await response.json()).toMatchObject({ ok: true, data: { leftGuild: true, leftGuildCount: 1 } });
            expect((await db.hostedGuilds.get(guildId))?.leftAt).toEqual(expect.any(Number));
            expect(await auditRowsAbout(guildId, ownerId)).toMatchObject([
                { actorId: operatorId, action: "block.create", targetType: "guild", targetId: guildId },
            ]);
        });

        it("an owner block writes exactly one audit row, with the operator as actor", async () => {
            const response = await block("user", ownerId);

            expect(response.status).toBe(201);
            expect(await auditRowsAbout(guildId, ownerId)).toMatchObject([
                { actorId: operatorId, action: "block.create", targetType: "user", targetId: ownerId },
            ]);
        });
    });
});
