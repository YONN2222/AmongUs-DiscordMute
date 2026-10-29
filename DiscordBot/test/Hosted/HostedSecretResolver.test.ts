import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { hashSecret } from "../../src/Hosted/GuildSecrets";
import { HostedSecretResolver } from "../../src/Hosted/HostedSecretResolver";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const MAX_SECRET_LENGTH = 64;

describe.each(backends)("HostedSecretResolver (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let resolver: HostedSecretResolver;
        let guildId: string;
        let ownerId: string;

        const createSecret = async () => (await db.guildSecrets.rotate(guildId, "admin")).secret;
        const storeGuild = () =>
            db.hostedGuilds.upsert({ guildId, name: "Guild", icon: null, ownerId, memberCount: 3, joinedAt: 1 });

        beforeEach(async () => {
            db = await openBackend(backend);
            const blocks = new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds });
            resolver = new HostedSecretResolver({ secrets: db.guildSecrets, blocks, hostedGuilds: db.hostedGuilds });
            guildId = uniqueId("guild");
            ownerId = uniqueId("owner");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("resolves a stored secret to its guild", async () => {
            await storeGuild();
            expect(await resolver.resolve(await createSecret())).toEqual({ guildId });
        });

        it("unknown, unprefixed or 65 char secret resolves to null without a db lookup", async () => {
            const secret = await createSecret();
            const lookup = vi.fn(async (hash: string) => db.guildSecrets.findGuildByHash(hash));
            const guarded = new HostedSecretResolver({
                secrets: { findGuildByHash: lookup },
                blocks: new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds }),
                hostedGuilds: db.hostedGuilds,
            });

            expect(await guarded.resolve(secret.slice("dmh_".length))).toBeNull();
            expect(await guarded.resolve(`dmh_${"a".repeat(MAX_SECRET_LENGTH + 1 - "dmh_".length)}`)).toBeNull();
            expect(lookup).not.toHaveBeenCalled();

            expect(await guarded.resolve("dmh_unknown")).toBeNull();
            expect(lookup).toHaveBeenCalledExactlyOnceWith(hashSecret("dmh_unknown"));
        });

        it("a secret of a guild the bot left resolves to null", async () => {
            await storeGuild();
            const secret = await createSecret();
            await db.hostedGuilds.markLeft(guildId, 5000);

            expect(await resolver.resolve(secret)).toBeNull();
        });

        it("blocked guild resolves as blocked", async () => {
            await storeGuild();
            const secret = await createSecret();
            await db.blocks.create({ type: "guild", targetId: guildId, reason: "test", blockedBy: "admin" });

            expect(await resolver.resolve(secret)).toEqual({ guildId, blocked: true });
        });

        it("guild of a blocked owner resolves as blocked", async () => {
            await storeGuild();
            const secret = await createSecret();
            await db.blocks.create({ type: "user", targetId: ownerId, reason: "test", blockedBy: "admin" });

            expect(await resolver.resolve(secret)).toEqual({ guildId, blocked: true });
        });
    });
});
