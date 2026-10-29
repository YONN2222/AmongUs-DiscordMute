import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { hashSecret } from "../../src/Hosted/GuildSecrets";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

describe.each(backends)("GuildSecretRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("guild");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("rotate returns a dmh_ secret and stores only its hash", async () => {
            const { secret, createdAt } = await db.guildSecrets.rotate(guildId, "admin-1", 5000);

            expect(secret.startsWith("dmh_")).toBe(true);
            expect(createdAt).toBe(5000);
            expect(await db.guildSecrets.findGuildByHash(hashSecret(secret))).toBe(guildId);

            const rows = await db.sequelize.query<Record<string, unknown>>(
                "SELECT * FROM guild_secrets WHERE guild_id = :guildId",
                { replacements: { guildId }, type: QueryTypes.SELECT },
            );
            expect(rows).toHaveLength(1);
            expect(Object.values(rows[0]).map(String)).not.toContain(secret);
        });

        it("old secret no longer resolves after rotation", async () => {
            const first = await db.guildSecrets.rotate(guildId, "admin-1");
            const second = await db.guildSecrets.rotate(guildId, "admin-2");

            expect(await db.guildSecrets.findGuildByHash(hashSecret(first.secret))).toBeNull();
            expect(await db.guildSecrets.findGuildByHash(hashSecret(second.secret))).toBe(guildId);
            expect(await db.guildSecrets.get(guildId)).toMatchObject({ createdBy: "admin-2" });
        });

        it("rotate reports replaced", async () => {
            expect((await db.guildSecrets.rotate(guildId, "admin-1")).replaced).toBe(false);
            expect((await db.guildSecrets.rotate(guildId, "admin-1")).replaced).toBe(true);
        });

        it("get returns null for a guild without a secret", async () => {
            expect(await db.guildSecrets.get(guildId)).toBeNull();
        });

        it("hasSecrets returns only guilds with a secret", async () => {
            const other = uniqueId("other");
            await db.guildSecrets.rotate(guildId, "admin-1");

            expect(await db.guildSecrets.hasSecrets([guildId, other])).toEqual(new Set([guildId]));
            expect(await db.guildSecrets.hasSecrets([])).toEqual(new Set());
        });
    });
});
