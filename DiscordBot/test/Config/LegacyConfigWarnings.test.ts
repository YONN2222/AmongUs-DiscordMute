import { describe, expect, it } from "vitest";
import { legacyConfigWarnings } from "../../src/Config/LegacyConfigWarnings";

const none: Parameters<typeof legacyConfigWarnings>[0] = {
    mode: "self-host",
    guildId: "g",
    secret: undefined,
    channelIds: [],
};

describe("legacyConfigWarnings", () => {
    it("is silent for a config without the deprecated keys", () => {
        expect(legacyConfigWarnings(none)).toEqual([]);
    });

    it("points a self-hoster with a secret to /setup", () => {
        const [warning, ...rest] = legacyConfigWarnings({ ...none, secret: "own-secret" });

        expect(warning).toContain('"secret"');
        expect(warning).toContain("/setup");
        expect(rest).toEqual([]);
    });

    it("warns harder when the secret is the default change-me", () => {
        const warnings = legacyConfigWarnings({ ...none, secret: "change-me" });

        expect(warnings).toHaveLength(2);
        expect(warnings[1]).toContain("change-me");
    });

    it("points a self-hoster with channelIds to the Voice page", () => {
        const [warning, ...rest] = legacyConfigWarnings({ ...none, channelIds: ["1"] });

        expect(warning).toContain('"channelIds"');
        expect(warning).toContain("Voice page");
        expect(rest).toEqual([]);
    });

    it("says channelIds is ignored without a guildId", () => {
        const [warning] = legacyConfigWarnings({ ...none, guildId: undefined, channelIds: ["1"] });

        expect(warning).toContain("ignored without");
    });

    it("says both keys are ignored in hosted mode", () => {
        const [warning] = legacyConfigWarnings({ ...none, mode: "hosted", secret: "x", channelIds: ["1"] });

        expect(warning).toContain("ignored in hosted mode");
        expect(legacyConfigWarnings({ ...none, mode: "hosted" })).toEqual([]);
    });
});
