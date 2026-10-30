import { describe, expect, it } from "vitest";
import { legacyConfigWarnings } from "../../src/Config/LegacyConfigWarnings";

describe("legacyConfigWarnings", () => {
    it("is silent for a config without the deprecated keys", () => {
        expect(legacyConfigWarnings({ mode: "self-host", secret: undefined, channelIds: [] })).toEqual([]);
    });

    it("points a self-hoster with a secret to /setup", () => {
        const [warning, ...rest] = legacyConfigWarnings({ mode: "self-host", secret: "x", channelIds: [] });

        expect(warning).toContain('"secret"');
        expect(warning).toContain("/setup");
        expect(rest).toEqual([]);
    });

    it("points a self-hoster with channelIds to the Voice page", () => {
        const [warning, ...rest] = legacyConfigWarnings({ mode: "self-host", secret: undefined, channelIds: ["1"] });

        expect(warning).toContain('"channelIds"');
        expect(warning).toContain("Voice page");
        expect(rest).toEqual([]);
    });

    it("stays silent in hosted mode", () => {
        expect(legacyConfigWarnings({ mode: "hosted", secret: "x", channelIds: ["1"] })).toEqual([]);
    });
});
