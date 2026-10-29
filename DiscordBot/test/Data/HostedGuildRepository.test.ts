import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { parseSettings } from "../../src/Settings/GuildSettings";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe.each(backends)("HostedGuildRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;
        let ownerId: string;

        const guild = (overrides: Partial<Parameters<Database["hostedGuilds"]["upsert"]>[0]> = {}) => ({
            guildId,
            name: "Crew Room",
            icon: null,
            ownerId,
            memberCount: 10,
            joinedAt: 1000,
            ...overrides,
        });

        async function countRows(table: string, id: string): Promise<number> {
            const rows = await db.sequelize.query<{ total: number | string }>(
                `SELECT COUNT(*) AS total FROM ${table} WHERE guild_id = :id`,
                { replacements: { id }, type: QueryTypes.SELECT },
            );
            return Number(rows[0].total);
        }

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("guild");
            ownerId = uniqueId("owner");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("upsert keeps joinedAt and botInstance", async () => {
            await db.hostedGuilds.upsert(guild(), 2000);
            await db.sequelize.query("UPDATE hosted_guilds SET bot_instance = 'second' WHERE guild_id = :guildId", {
                replacements: { guildId },
            });
            await db.hostedGuilds.upsert(
                guild({ name: "Renamed", icon: "abc", memberCount: 11, joinedAt: 9999 }),
                3000,
            );

            expect(await db.hostedGuilds.get(guildId)).toEqual({
                guildId,
                name: "Renamed",
                icon: "abc",
                ownerId,
                memberCount: 11,
                joinedAt: 1000,
                botInstance: "second",
                updatedAt: 3000,
                leftAt: null,
            });
        });

        it("markLeft keeps the data and never moves an existing leave time", async () => {
            await db.hostedGuilds.upsert(guild());
            await db.links.upsert(guildId, "user-1", "Crew");

            await db.hostedGuilds.markLeft(guildId, 5000);
            await db.hostedGuilds.markLeft(guildId, 9000);

            expect((await db.hostedGuilds.get(guildId))?.leftAt).toBe(5000);
            expect(await countRows("links", guildId)).toBe(1);
        });

        it("an upsert keeps the leave time and clearLeft removes it", async () => {
            await db.hostedGuilds.upsert(guild());
            await db.hostedGuilds.markLeft(guildId, 5000);

            await db.hostedGuilds.upsert(guild({ name: "Back" }));
            expect((await db.hostedGuilds.get(guildId))?.leftAt).toBe(5000);

            await db.hostedGuilds.clearLeft(guildId);
            expect((await db.hostedGuilds.get(guildId))?.leftAt).toBeNull();
        });

        it("listLeftBefore returns only guilds that left at or before the cutoff", async () => {
            const recent = uniqueId("guild");
            const stayed = uniqueId("guild");
            for (const id of [guildId, recent, stayed]) await db.hostedGuilds.upsert(guild({ guildId: id }));
            await db.hostedGuilds.markLeft(guildId, 1000);
            await db.hostedGuilds.markLeft(recent, 1001);

            const ids = await db.hostedGuilds.listLeftBefore(1000);

            expect(ids).toContain(guildId);
            expect(ids).not.toContain(recent);
            expect(ids).not.toContain(stayed);
        });

        it("count, listIds and listByOwner leave out guilds the bot left", async () => {
            const before = await db.hostedGuilds.count();
            await db.hostedGuilds.upsert(guild());
            await db.hostedGuilds.markLeft(guildId, 5000);

            expect(await db.hostedGuilds.count()).toBe(before);
            expect(await db.hostedGuilds.listIds()).not.toContain(guildId);
            expect(await db.hostedGuilds.listByOwner(ownerId)).toEqual([]);
        });

        it("a new guild gets the default bot instance", async () => {
            await db.hostedGuilds.upsert(guild());
            expect((await db.hostedGuilds.get(guildId))?.botInstance).toBe("default");
            expect(await db.hostedGuilds.get(uniqueId("missing"))).toBeNull();
        });

        it("listByOwner returns only that owner's guilds", async () => {
            const second = uniqueId("guild");
            await db.hostedGuilds.upsert(guild({ joinedAt: 1000 }));
            await db.hostedGuilds.upsert(guild({ guildId: second, joinedAt: 2000 }));
            await db.hostedGuilds.upsert(guild({ guildId: uniqueId("guild"), ownerId: uniqueId("owner") }));

            expect((await db.hostedGuilds.listByOwner(ownerId)).map((row) => row.guildId)).toEqual([second, guildId]);
        });

        it("listIds and count include stored guilds", async () => {
            const before = await db.hostedGuilds.count();
            await db.hostedGuilds.upsert(guild());

            expect(await db.hostedGuilds.count()).toBe(before + 1);
            expect(await db.hostedGuilds.listIds()).toContain(guildId);
        });

        it("search treats % and _ literally", async () => {
            const tag = uniqueId("tag");
            const percent = uniqueId("guild");
            const underscore = uniqueId("guild");
            await db.hostedGuilds.upsert(guild({ name: `${tag} 100% sure` }));
            await db.hostedGuilds.upsert(guild({ guildId: percent, name: `${tag} 100 sure` }));
            await db.hostedGuilds.upsert(guild({ guildId: underscore, name: `${tag} a_b` }));
            await db.hostedGuilds.upsert(guild({ guildId: uniqueId("guild"), name: `${tag} axb` }));

            const byPercent = await db.hostedGuilds.search({ q: "100%", offset: 0, limit: 10 });
            expect(byPercent.rows.map((row) => row.guildId)).toEqual([guildId]);
            const byUnderscore = await db.hostedGuilds.search({ q: "a_b", offset: 0, limit: 10 });
            expect(byUnderscore.rows.map((row) => row.guildId)).toEqual([underscore]);
            expect(byUnderscore.total).toBe(1);
        });

        it("search is case-insensitive on both dialects", async () => {
            const tag = uniqueId("tag").toUpperCase();
            await db.hostedGuilds.upsert(guild({ name: `Crew ${tag}` }));

            const result = await db.hostedGuilds.search({ q: tag.toLowerCase(), offset: 0, limit: 10 });
            expect(result.rows.map((row) => row.guildId)).toEqual([guildId]);
        });

        it("search by exact id", async () => {
            await db.hostedGuilds.upsert(guild());
            await db.hostedGuilds.upsert(guild({ guildId: uniqueId("guild") }));

            const result = await db.hostedGuilds.search({ q: guildId, offset: 0, limit: 10 });
            expect(result.rows.map((row) => row.guildId)).toEqual([guildId]);
            expect(result.total).toBe(1);
        });

        it("search pages newest first and reports the total", async () => {
            const tag = uniqueId("tag");
            const ids = [uniqueId("guild"), uniqueId("guild"), uniqueId("guild")];
            for (const [index, id] of ids.entries()) {
                await db.hostedGuilds.upsert(guild({ guildId: id, name: tag, joinedAt: 1000 + index }));
            }

            const page = await db.hostedGuilds.search({ q: tag, offset: 1, limit: 1 });
            expect(page.rows.map((row) => row.guildId)).toEqual([ids[1]]);
            expect(page.total).toBe(3);
        });

        it("purgeGuild removes every guild-scoped row and keeps other guilds", async () => {
            const other = uniqueId("other");
            const seed = async (id: string) => {
                await db.hostedGuilds.upsert(guild({ guildId: id }));
                await db.guildSecrets.rotate(id, "admin-1");
                await db.links.upsert(id, "user-1", "Crew");
                await db.pendingLinks.create({
                    guildId: id,
                    discordId: "user-2",
                    phrase: uniqueId("phrase"),
                    quickChatCode: uniqueId("code"),
                    quickChatIds: [1, 2],
                    expiresAt: Date.now() + 60_000,
                });
                await db.settings.save(id, parseSettings({}));
                await db.trackedMessages.upsert({
                    guildId: id,
                    kind: "status",
                    key: "",
                    channelId: "channel-1",
                    messageId: "message-1",
                    deleteAt: null,
                });
                await db.muteLedger.add(id, "user-1");
                await db.nicknameLedger.set(id, "user-1", "Bob", "Red");
            };
            await seed(guildId);
            await seed(other);
            await db.blocks.create({ type: "guild", targetId: guildId, reason: "spam", blockedBy: "system" });
            await db.audit.record({ actorId: "system", action: "guild.leave", targetType: "guild", targetId: guildId });

            await db.hostedGuilds.purgeGuild(guildId);

            const tables = [
                "links",
                "pending_links",
                "guild_settings",
                "tracked_messages",
                "mute_ledger",
                "nickname_ledger",
                "guild_secrets",
                "hosted_guilds",
            ];
            for (const table of tables) {
                expect(await countRows(table, guildId), `${table} of the purged guild`).toBe(0);
                expect(await countRows(table, other), `${table} of the other guild`).toBe(1);
            }
            expect(await db.blocks.isBlocked("guild", guildId)).toBe(true);
            expect((await db.audit.list({ targetId: guildId, offset: 0, limit: 10 })).total).toBe(1);
        });
    });
});
