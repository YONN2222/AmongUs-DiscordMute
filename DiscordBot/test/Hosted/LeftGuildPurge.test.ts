import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { LEFT_GUILD_RETENTION_MS } from "../../src/Data/Repositories/HostedGuildRepository";
import { purgeLeftGuilds } from "../../src/Hosted/LeftGuildPurge";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const LEFT_AT = 1_000_000;

describe.each(backends)("purgeLeftGuilds (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;

        async function storeGuild(guildId: string, leftAt: number | null): Promise<void> {
            await db.hostedGuilds.upsert({
                guildId,
                name: "Crew",
                icon: null,
                ownerId: uniqueId("owner"),
                memberCount: 3,
                joinedAt: 1,
            });
            await db.links.upsert(guildId, "user-1", "Crew");
            if (leftAt !== null) await db.hostedGuilds.markLeft(guildId, leftAt);
        }

        const purgeAudits = async (guildId: string) =>
            (await db.audit.list({ targetId: guildId, action: "guild.purge", offset: 0, limit: 10 })).rows;

        beforeEach(async () => {
            db = await openBackend(backend);
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("purges only guilds that left seven days ago or earlier and audits each once", async () => {
            const expired = uniqueId("guild");
            const recent = uniqueId("guild");
            const stayed = uniqueId("guild");
            await storeGuild(expired, LEFT_AT);
            await storeGuild(recent, LEFT_AT + 1);
            await storeGuild(stayed, null);

            await purgeLeftGuilds(db, LEFT_AT + LEFT_GUILD_RETENTION_MS);
            await purgeLeftGuilds(db, LEFT_AT + LEFT_GUILD_RETENTION_MS);

            expect(await db.hostedGuilds.get(expired)).toBeNull();
            expect(await db.links.findByAccountName(expired, "Crew")).toEqual([]);
            expect(await db.hostedGuilds.get(recent)).not.toBeNull();
            expect(await db.hostedGuilds.get(stayed)).not.toBeNull();
            const [entry, ...others] = await purgeAudits(expired);
            expect(others).toEqual([]);
            expect(entry).toMatchObject({ actorId: "system", targetType: "guild", targetId: expired });
            expect(await purgeAudits(recent)).toEqual([]);
        });
    });
});
