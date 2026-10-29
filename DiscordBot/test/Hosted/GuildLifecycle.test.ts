import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { type GuildInfo, GuildLifecycle, type GuildPort } from "../../src/Hosted/GuildLifecycle";
import { logger } from "../../src/Logging/Logger";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

class FakeGuildPort implements GuildPort {
    cached: GuildInfo[] = [];
    owned = new Set<string>();
    gone = new Set<string>();
    leaveResult = true;
    readonly left: string[] = [];

    async leave(guildId: string): Promise<boolean> {
        this.left.push(guildId);
        return this.leaveResult;
    }

    cachedGuilds(): GuildInfo[] {
        return this.cached;
    }

    ownsGuild(guildId: string): boolean {
        return this.owned.has(guildId);
    }

    async isGone(guildId: string): Promise<boolean> {
        return this.gone.has(guildId);
    }
}

describe.each(backends)("GuildLifecycle (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        const NOW = 5_000;
        let db: Database;
        let port: FakeGuildPort;
        let lifecycle: GuildLifecycle;
        let guildId: string;
        let ownerId: string;

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
            port = new FakeGuildPort();
            guildId = uniqueId("guild");
            ownerId = uniqueId("owner");
            lifecycle = new GuildLifecycle({
                port,
                hostedGuilds: db.hostedGuilds,
                blocks: new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds }),
                audit: db.audit,
                now: () => NOW,
            });
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

        it("guild delete purges its data", async () => {
            await lifecycle.onGuildCreate(info());
            await db.guildSecrets.rotate(guildId, ownerId);
            await db.links.upsert(guildId, "u1", "Crew");

            await lifecycle.onGuildDelete(guildId);

            expect(await db.hostedGuilds.get(guildId)).toBeNull();
            expect(await db.guildSecrets.get(guildId)).toBeNull();
            expect(await db.links.findByAccountName(guildId, "Crew")).toEqual([]);
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

            it("purges guilds this cluster owns that are gone and keeps other clusters' rows", async () => {
                const goneId = uniqueId("gone");
                const otherClusterId = uniqueId("other");
                for (const id of [goneId, otherClusterId]) {
                    await db.hostedGuilds.upsert({ ...info({ guildId: id }), joinedAt: 1 });
                }
                await db.links.upsert(goneId, "u1", "Crew");
                port.owned = new Set([goneId]);
                port.gone = new Set([goneId, otherClusterId]);

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(goneId)).toBeNull();
                expect(await db.links.findByAccountName(goneId, "Crew")).toEqual([]);
                expect(await db.hostedGuilds.get(otherClusterId)).not.toBeNull();
            });

            it("keeps a missing guild that Discord does not report as unknown", async () => {
                const missingId = uniqueId("missing");
                await db.hostedGuilds.upsert({ ...info({ guildId: missingId }), joinedAt: 1 });
                port.owned = new Set([missingId]);

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(missingId)).not.toBeNull();
            });

            it("keeps a cached guild even when Discord would call it gone", async () => {
                port.cached = [info()];
                port.owned = new Set([guildId]);
                port.gone = new Set([guildId]);

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(guildId)).not.toBeNull();
            });

            it("goes on with the other guilds when one fails", async () => {
                const failingId = uniqueId("failing");
                const goneId = uniqueId("gone");
                await db.hostedGuilds.upsert({ ...info({ guildId: failingId }), joinedAt: 1 });
                await db.hostedGuilds.upsert({ ...info({ guildId: goneId }), joinedAt: 1 });
                port.owned = new Set([failingId, goneId]);
                port.gone = new Set([goneId]);
                const isGone = port.isGone.bind(port);
                port.isGone = async (id) => {
                    if (id === failingId) throw new Error("discord down");
                    return isGone(id);
                };

                await lifecycle.reconcile();

                expect(await db.hostedGuilds.get(failingId)).not.toBeNull();
                expect(await db.hostedGuilds.get(goneId)).toBeNull();
            });
        });

        describe("leave", () => {
            it("reports whether the bot was in the guild", async () => {
                expect(await lifecycle.leave(guildId, "admin")).toBe(true);
                port.leaveResult = false;
                expect(await lifecycle.leave(guildId, "admin")).toBe(false);
            });

            it("leaves for an admin without writing an automatic audit entry", async () => {
                await lifecycle.leave(guildId, "admin");

                expect(port.left).toEqual([guildId]);
                expect(await auditRows()).toEqual([]);
            });

            it("audits the reason of an automatic leave", async () => {
                await lifecycle.leave(guildId, "owner-blocked");

                expect((await auditRows())[0]).toMatchObject({
                    action: "guild.auto-leave",
                    details: { reason: "owner-blocked" },
                });
            });
        });
    });
});
