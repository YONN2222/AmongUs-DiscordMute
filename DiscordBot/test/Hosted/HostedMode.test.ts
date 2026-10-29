import { describe, expect, it } from "vitest";
import { isHosted, readAdminApiToken } from "../../src/Hosted/HostedMode";

describe("isHosted", () => {
    it("is true only for hosted mode", () => {
        expect(isHosted({ mode: "hosted" })).toBe(true);
        expect(isHosted({ mode: "self-host" })).toBe(false);
    });
});

describe("readAdminApiToken", () => {
    const message = "ADMIN_API_TOKEN must be set to at least 32 characters in hosted mode";

    it("rejects a 31 char token", () => {
        expect(() => readAdminApiToken({ ADMIN_API_TOKEN: "a".repeat(31) })).toThrow(message);
    });

    it("rejects a missing token", () => {
        expect(() => readAdminApiToken({})).toThrow(message);
    });

    it("returns a 32 char token", () => {
        const token = "b".repeat(32);
        expect(readAdminApiToken({ ADMIN_API_TOKEN: token })).toBe(token);
    });
});
