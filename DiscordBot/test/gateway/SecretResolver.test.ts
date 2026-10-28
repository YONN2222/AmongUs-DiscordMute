import { describe, expect, it } from "vitest";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";

describe("SelfHostSecretResolver", () => {
    const resolver = new SelfHostSecretResolver({ secret: "s3cret", guildId: "guild-1" });

    it("returns the configured guild for the right secret", async () => {
        expect(await resolver.resolve("s3cret")).toEqual({ guildId: "guild-1" });
    });

    it("rejects a wrong secret of the same length", async () => {
        expect(await resolver.resolve("s3cre7")).toBeNull();
    });

    it("rejects a secret of a different length without throwing", async () => {
        expect(await resolver.resolve("s3")).toBeNull();
        expect(await resolver.resolve("s3cret-but-longer")).toBeNull();
        expect(await resolver.resolve("")).toBeNull();
    });
});
