import { describe, expect, it } from "vitest";
import { isNewer, parseVersion } from "../../src/Updates/VersionCompare";

describe("versionCompare", () => {
    it("v3.0.1 is newer than 3.0.0", () => {
        expect(isNewer("v3.0.1", "3.0.0")).toBe(true);
    });

    it("3.0.0 is not newer than v3.0.0", () => {
        expect(isNewer("3.0.0", "v3.0.0")).toBe(false);
    });

    it("3.0.0 is newer than 3.0.0-beta.1", () => {
        expect(isNewer("3.0.0", "3.0.0-beta.1")).toBe(true);
        expect(isNewer("3.0.0-beta.1", "3.0.0")).toBe(false);
    });

    it("10.0.0 is newer than 9.9.9", () => {
        expect(isNewer("10.0.0", "9.9.9")).toBe(true);
    });

    it('"latest", "v3", "" are unparsable and never newer', () => {
        for (const raw of ["latest", "v3", ""]) {
            expect(parseVersion(raw)).toBeNull();
            expect(isNewer(raw, "1.0.0")).toBe(false);
            expect(isNewer("9.0.0", raw)).toBe(false);
        }
    });

    it("parses the optional prefix and prerelease", () => {
        expect(parseVersion("V2.1.0-rc.1")).toEqual({ major: 2, minor: 1, patch: 0, pre: "rc.1" });
    });
});
