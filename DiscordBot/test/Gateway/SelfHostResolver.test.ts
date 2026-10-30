import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { selfHostResolver } from "../../src/Gateway/RunGateway";
import { createTestDatabase, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const LEGACY_SECRET = "legacy-test-secret";

describe("selfHostResolver", () => {
    let db: Database;
    let guildId: string;

    beforeEach(async () => {
        db = await createTestDatabase();
        guildId = uniqueId("guild");
    });

    afterEach(async () => {
        await purgeTestRows(db);
        await db.close();
    });

    it("accepts a /setup secret when config.json has no secret", async () => {
        const resolver = selfHostResolver({ guildId: undefined, secret: undefined }, db);
        const { secret } = await db.guildSecrets.rotate(guildId, "admin");

        expect(await resolver.resolve(secret)).toEqual({ guildId });
        expect(await resolver.resolve(LEGACY_SECRET)).toBeNull();
    });

    it("accepts the config.json secret until its server creates a /setup secret", async () => {
        const resolver = selfHostResolver({ guildId, secret: LEGACY_SECRET }, db);
        expect(await resolver.resolve(LEGACY_SECRET)).toEqual({ guildId });

        const { secret } = await db.guildSecrets.rotate(guildId, "admin");

        expect(await resolver.resolve(LEGACY_SECRET)).toBeNull();
        expect(await resolver.resolve(secret)).toEqual({ guildId });
    });

    it("keeps the config.json secret when another server creates a /setup secret", async () => {
        const resolver = selfHostResolver({ guildId, secret: LEGACY_SECRET }, db);
        await db.guildSecrets.rotate(uniqueId("other"), "admin");

        expect(await resolver.resolve(LEGACY_SECRET)).toEqual({ guildId });
    });
});
