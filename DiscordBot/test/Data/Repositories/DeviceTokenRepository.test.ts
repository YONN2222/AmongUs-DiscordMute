import { QueryTypes } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../../src/Data/Database";
import { hashSecret, hasSecretFormat } from "../../../src/Gateway/GuildSecrets";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../../Helpers/TestDatabase";

describe.each(backends)("DeviceTokenRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("g");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("creates a token in the secret format and stores only its hash", async () => {
            const token = await db.deviceTokens.create(guildId, "android", 1000);

            expect(hasSecretFormat(token)).toBe(true);
            const [row] = await db.sequelize.query<{ token_hash: string }>(
                "SELECT token_hash FROM device_tokens WHERE guild_id = :guildId",
                { replacements: { guildId }, type: QueryTypes.SELECT },
            );
            expect(row?.token_hash).toBe(hashSecret(token));
        });

        it("use maps the token to its guild and records the time", async () => {
            const token = await db.deviceTokens.create(guildId, "android", 1000);

            expect(await db.deviceTokens.use(hashSecret(token), 5000)).toBe(guildId);
            expect(await db.deviceTokens.list(guildId, 10)).toEqual([
                { id: expect.any(String), guildId, platform: "android", createdAt: 1000, lastUsedAt: 5000 },
            ]);
            expect(await db.deviceTokens.use(hashSecret("dmh_unknown"), 5000)).toBeNull();
        });

        it("lists the guild's devices newest first, never used ones without a time", async () => {
            await db.deviceTokens.create(guildId, "windows", 1000);
            await db.deviceTokens.create(guildId, "android", 2000);
            await db.deviceTokens.create(uniqueId("other"), "android", 3000);

            const devices = await db.deviceTokens.list(guildId, 10);
            expect(devices.map((device) => [device.platform, device.lastUsedAt])).toEqual([
                ["android", null],
                ["windows", null],
            ]);
            expect(await db.deviceTokens.list(guildId, 1)).toHaveLength(1);
        });

        it("removes a device only from its own guild", async () => {
            const token = await db.deviceTokens.create(guildId, "android", 1000);
            const [device] = await db.deviceTokens.list(guildId, 10);

            expect(await db.deviceTokens.remove(uniqueId("other"), device.id)).toBe(false);
            expect(await db.deviceTokens.remove(guildId, device.id)).toBe(true);
            expect(await db.deviceTokens.use(hashSecret(token), 2000)).toBeNull();
        });
    });
});
