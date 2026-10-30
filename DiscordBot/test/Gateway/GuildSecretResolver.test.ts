import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { GuildSecretResolver } from "../../src/Gateway/GuildSecretResolver";
import { ChainedSecretResolver, SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { createTestDatabase, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const LEGACY_SECRET = "legacy-test-secret";

describe("self-host secret resolution", () => {
    let db: Database;
    let guildId: string;
    let legacyGuildId: string;
    let resolver: ChainedSecretResolver;

    beforeEach(async () => {
        db = await createTestDatabase();
        guildId = uniqueId("guild");
        legacyGuildId = uniqueId("legacy-guild");
        resolver = new ChainedSecretResolver([
            new GuildSecretResolver(db.guildSecrets),
            new SelfHostSecretResolver({ secret: LEGACY_SECRET, guildId: legacyGuildId }),
        ]);
    });

    afterEach(async () => {
        await purgeTestRows(db);
        await db.close();
    });

    it("resolves a secret created with /setup to its guild", async () => {
        const { secret } = await db.guildSecrets.rotate(guildId, "admin");

        expect(await resolver.resolve(secret)).toEqual({ guildId });
    });

    it("keeps accepting the deprecated config.json secret", async () => {
        expect(await resolver.resolve(LEGACY_SECRET)).toEqual({ guildId: legacyGuildId });
    });

    it("stops accepting a replaced secret", async () => {
        const { secret } = await db.guildSecrets.rotate(guildId, "admin");
        await db.guildSecrets.rotate(guildId, "admin");

        expect(await resolver.resolve(secret)).toBeNull();
    });

    it("rejects unknown secrets", async () => {
        expect(await resolver.resolve("dmh_unknown")).toBeNull();
        expect(await resolver.resolve("")).toBeNull();
    });

    it("works without the deprecated secret", async () => {
        const dbOnly = new ChainedSecretResolver([new GuildSecretResolver(db.guildSecrets)]);

        expect(await dbOnly.resolve(LEGACY_SECRET)).toBeNull();
    });
});
