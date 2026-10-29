import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import {
    type GuildInfo,
    GuildLifecycle,
    type GuildLifecycleDeps,
    type GuildPort,
} from "../../src/Hosted/GuildLifecycle";
import { logger } from "../../src/Logging/Logger";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

class FakeGuildPort implements GuildPort {
    cached: GuildInfo[] = [];
    /** Cached guilds that are unavailable (outage): present in the cache but without data. */
    unavailableIds: string[] = [];
    owned = new Set<string>();
    members = new Set<string>();
    membersFailure: Error | null = null;
    leaveResult = true;
    readonly left: string[] = [];

    constructor(private readonly steps: string[]) {}

    async leave(guildId: string): Promise<boolean> {
        this.left.push(guildId);
        this.steps.push(`leave ${guildId}`);
        return this.leaveResult;
    }

    cachedGuilds(): GuildInfo[] {
        return this.cached;
    }

    ownsGuild(guildId: string): boolean {
        return this.owned.has(guildId);
    }

    cachedGuildIds(): string[] {
        return [...this.cached.map((info) => info.guildId), ...this.unavailableIds];
    }

    async fetchMemberGuildIds(): Promise<Set<string>> {
        if (this.membersFailure) throw this.membersFailure;
        return this.members;
    }
}

describe.each(backends)("GuildLifecycle (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        const NOW = 5_000;
        let db: Database;
        let port: FakeGuildPort;
        let lifecycle: GuildLifecycle;
        let deps: GuildLifecycleDeps;
        let guildId: string;
        let ownerId: string;
        /** The order in which games were ended and guilds left. */
        let steps: string[];
        let endGamesFailure: Error | null;

        const info = (overrides: Partial<GuildInfo> = {}): GuildInfo => ({
            guildId,
            name: "Crew Room",
            icon: null,
            ownerId,
            memberCount: 12,
            ...overrides,
        });

        const blockUser = (id: string) =>
            db.blocks.create({ type: "user", targetId: id, reason: "test", blockedBy: "system" });
        const blockGuild = (id: string) =>
            db.blocks.create({ type: "guild", targetId: id, reason: "test", blockedBy: "system" });
        const auditRows = async () => (await db.audit.list({ targetId: guildId, offset: 0, limit: 10 })).rows;

        beforeEach(async () => {
            vi.spyOn(logger, "error").mockImplementation(() => {});
            db = await openBackend(backend);
            steps = [];
            endGamesFailure = null;
            port = new FakeGuildPort(steps);
            guildId = uniqueId("guild");
            ownerId = uniqueId("owner");
            deps = {
                port,
                hostedGuilds: db.hostedGuilds,
                blocks: new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds }),
                audit: db.audit,
                games: {
                    end: async (id) => {
                        if (endGamesFailure) throw endGamesFailure;
                        steps.push(`end games ${id}`);
                    },
                    reopen: (id) => {
                        steps.push(`reopen ${id}`);
                    },
                    forget: (id) => {
                        steps.push(`forget games ${id}`);
                    },
                    recover: async (id) => {
                        steps.push(`recover ${id}`);
                    },
                },
                disconnectBlocked: async (id, reason) => {
                    steps.push(`disconnect ${id} ${reason}`);
                },
                disconnectRemoved: async (id) => {
                    steps.push(`disconnect ${id} removed`);
                },
                now: () => NOW,
            };
            lifecycle = new GuildLifecycle(deps);
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
            vi.restoreAllMocks();
        });

        it("joining a normal guild stores its row", async () => {
            await lifecycle.onGuildCreate(info());

            expect(await db.hostedGuilds.get(guildId)).toMatchObject({
                guildId,
                name: "Crew Room",
                ownerId,
                memberCount: 12,
                joinedAt: NOW,
            });
            expect(port.left).toEqual([]);
            expect(await auditRows()).toEqual([]);
        });

        it("joining a blocked guild leaves at once and audits", async () => {
            await blockGuild(guildId);

            await lifecycle.onGuildCreate(info());

            expect(port.left).toEqual([guildId]);
            const [entry, ...others] = await auditRows();
            expect(others).toEqual([]);
            expect(entry).toMatchObject({
                actorId: "system",
                action: "guild.auto-leave",
                targetType: "guild",
                targetId: guildId,
                details: { reason: "guild-blocked" },
            });
        });

        it("joining a guild of a blocked owner leaves", async () => {
            await blockUser(ownerId);

            await lifecycle.onGuildCreate(info());

            expect(port.left).toEqual([guildId]);
            expect((await auditRows())[0].details).toEqual({ reason: "owner-blocked" });
        });

        it("ownership transfer to a blocked user leaves", async () => {
            const newOwner = uniqueId("new-owner");
            await blockUser(newOwner);
            await lifecycle.onGuildCreate(info());
            expect(port.left).toEqual([]);

            await lifecycle.onGuildUpdate(info({ ownerId: newOwner, name: "Renamed" }));

            expect(port.left).toEqual([guildId]);
            expect(await db.hostedGuilds.get(guildId)).toMatchObject({ ownerId: newOwner, name: "Renamed" });
        });

        it("ends the games of the guild before an auto leave", async () => {
            await lifecycle.onGuildCreate(info());
            await blockUser(ownerId);
            steps.length = 0;

            await lifecycle.onGuildUpdate(info());

            expect(steps).toEqual([
                `disconnect ${guildId} owner-blocked`,
                `end games ${guildId}`,
                `leave ${guildId}`,
                `reopen ${guildId}`,
            ]);
        });

        it("an update refreshes the stored name and member count", async () => {
            await lifecycle.onGuildCreate(info());

            await lifecycle.onGuildUpdate(info({ name: "New Name", memberCount: 40 }));

            expect(await db.hostedGuilds.get(guildId)).toMatchObject({
                name: "New Name",
                memberCount: 40,
                joinedAt: NOW,
            });
            expect(port.left).toEqual([]);
        });

        it("does not audit an auto leave that did not happen", async () => {
            await blockGuild(guildId);
            port.leaveResult = false;

            await lifecycle.onGuildCreate(info());

            expect(await auditRows()).toEqual([]);
        });

        it("guild delete marks the guild as left and keeps its data", async () => {
            await lifecycle.onGuildCreate(info());
            await db.guildSecrets.rotate(guildId, ownerId);
            await db.links.upsert(guildId, "u1", "Crew");

            await lifecycle.onGuildDelete(guildId);

            expect((await db.hostedGuilds.get(guildId))?.leftAt).toBe(NOW);
            expect(await db.guildSecrets.get(guildId)).not.toBeNull();
            expect(await db.links.findByAccountName(guildId, "Crew")).toHaveLength(1);
        });

        it("guild delete forgets the games and disconnects the plugins without leaving or ending games", async () => {
            await lifecycle.onGuildCreate(info());
            steps.length = 0;

            await lifecycle.onGuildDelete(guildId);

            expect(steps).toEqual([`forget games ${guildId}`, `disconnect ${guildId} removed`]);
        });

        it("a re-invite recovers the guild first, then clears the leave time and keeps the data", async () => {
            await lifecycle.onGuildCreate(info());
            await db.links.upsert(guildId, "u1", "Crew");
            await lifecycle.onGuildDelete(guildId);
            let leftAtRecovery: number | null | undefined;
            const later = new GuildLifecycle({
                ...deps,
                games: {
                    ...deps.games,
                    recover: async (id) => {
                        leftAtRecovery = (await db.hostedGuilds.get(id))?.leftAt;
                    },
                },
            });

            await later.onGuildCreate(info());

            expect(leftAtRecovery).toBe(NOW);
            expect((await db.hostedGuilds.get(guildId))?.leftAt).toBeNull();
            expect(await db.links.findByAccountName(guildId, "Crew")).toHaveLength(1);
        });

        it("a blocked guild invited again leaves at once and keeps its first leave time", async () => {
            await lifecycle.onGuildCreate(info());
            await lifecycle.onGuildDelete(guildId);
            await blockGuild(guildId);
            const later = new GuildLifecycle({ ...deps, now: () => NOW + 60_000 });

            await later.onGuildCreate(info());
            await later.onGuildDelete(guildId);

            expect(port.left).toEqual([guildId]);
            expect((await db.hostedGuilds.get(guildId))?.leftAt).toBe(NOW);
        });

        describe("reconcile", () => {
            it("stores every cached guild and leaves the blocked ones", async () => {
                const blockedId = uniqueId("blocked");
                await blockGuild(blockedId);
                port.cached = [info(), info({ guildId: blockedId, name: "Blocked" })];

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(guildId)).not.toBeNull();
                expect(port.left).toEqual([blockedId]);
            });

            it("marks a guild that removed the bot while offline as left and keeps other clusters' rows", async () => {
                const goneId = uniqueId("gone");
                const otherClusterId = uniqueId("other");
                for (const id of [goneId, otherClusterId]) {
                    await db.hostedGuilds.upsert({ ...info({ guildId: id }), joinedAt: 1 });
                }
                await db.links.upsert(goneId, "u1", "Crew");
                port.owned = new Set([goneId]);

                await lifecycle.reconcile();

                expect((await db.hostedGuilds.get(goneId))?.leftAt).toBe(NOW);
                expect(await db.links.findByAccountName(goneId, "Crew")).toHaveLength(1);
                expect((await db.hostedGuilds.get(otherClusterId))?.leftAt).toBeNull();
            });

            it("keeps a guild that is still in the member list", async () => {
                const stillThere = uniqueId("there");
                await db.hostedGuilds.upsert({ ...info({ guildId: stillThere }), joinedAt: 1 });
                port.owned = new Set([stillThere]);
                port.members = new Set([stillThere]);

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(stillThere)).not.toBeNull();
            });

            it("a cached but unavailable guild never gets purged", async () => {
                const unavailable = uniqueId("unavailable");
                await db.hostedGuilds.upsert({ ...info({ guildId: unavailable }), joinedAt: 1 });
                port.owned = new Set([unavailable]);
                port.unavailableIds = [unavailable];

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(unavailable)).not.toBeNull();
            });

            it("a cached guild is kept even when the member list lacks it", async () => {
                port.cached = [info()];
                port.owned = new Set([guildId]);

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(guildId)).not.toBeNull();
            });

            it("clears the leave time of a guild that added the bot back while it was offline", async () => {
                await db.hostedGuilds.upsert({ ...info(), joinedAt: 1 });
                await db.hostedGuilds.markLeft(guildId, 1);
                port.cached = [info()];
                port.owned = new Set([guildId]);

                await lifecycle.reconcile();

                expect((await db.hostedGuilds.get(guildId))?.leftAt).toBeNull();
            });

            it("a member list failure marks nothing as left", async () => {
                const goneId = uniqueId("gone");
                await db.hostedGuilds.upsert({ ...info({ guildId: goneId }), joinedAt: 1 });
                port.owned = new Set([goneId]);
                port.membersFailure = new Error("discord down");

                await lifecycle.reconcile();

                expect((await db.hostedGuilds.get(goneId))?.leftAt).toBeNull();
            });

            it("goes on with the other guilds when tracking one fails", async () => {
                const failingId = uniqueId("failing");
                const goneId = uniqueId("gone");
                await db.hostedGuilds.upsert({ ...info({ guildId: goneId }), joinedAt: 1 });
                port.owned = new Set([goneId]);
                port.cached = [info({ guildId: failingId }), info()];
                const upsert = vi.spyOn(db.hostedGuilds, "upsert");
                upsert.mockRejectedValueOnce(new Error("db hiccup"));

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(guildId)).not.toBeNull();
                expect((await db.hostedGuilds.get(goneId))?.leftAt).toBe(NOW);
            });
        });

        describe("leave", () => {
            it("reports whether the bot was in the guild", async () => {
                expect(await lifecycle.leave(guildId)).toBe(true);
                port.leaveResult = false;
                expect(await lifecycle.leave(guildId)).toBe(false);
            });

            it("leaves without an audit entry, the caller writes it", async () => {
                await lifecycle.leave(guildId);

                expect(port.left).toEqual([guildId]);
                expect(await auditRows()).toEqual([]);
            });

            it("ends the games of the guild first and reopens it once the leave returned", async () => {
                await lifecycle.leave(guildId);

                expect(steps).toEqual([`end games ${guildId}`, `leave ${guildId}`, `reopen ${guildId}`]);
            });

            it("does not disconnect the plugins itself, the admin path already did", async () => {
                await lifecycle.leave(guildId);

                expect(steps.some((step) => step.startsWith("disconnect"))).toBe(false);
            });

            it("stays in the guild when its games could not be ended", async () => {
                endGamesFailure = new Error("database down");

                await expect(lifecycle.leave(guildId)).rejects.toThrow("database down");

                expect(port.left).toEqual([]);
                expect(steps).toEqual([`reopen ${guildId}`]);
            });
        });
    });
});
