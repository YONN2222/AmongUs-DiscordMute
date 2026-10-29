import { describe, expect, it } from "vitest";
import { generateSecret, hashSecret, SECRET_PREFIX } from "../../src/Hosted/GuildSecrets";

describe("guild secrets", () => {
    it("hashSecret is sha256 hex", () => {
        expect(hashSecret("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });

    it("generateSecret is 47 chars with the dmh_ prefix and unique over 1000 calls", () => {
        const secrets = new Set(Array.from({ length: 1000 }, generateSecret));
        expect(secrets.size).toBe(1000);
        for (const secret of secrets) {
            expect(secret).toHaveLength(47);
            expect(secret.startsWith(SECRET_PREFIX)).toBe(true);
            expect(secret).toMatch(/^dmh_[A-Za-z0-9_-]{43}$/);
        }
    });
});
