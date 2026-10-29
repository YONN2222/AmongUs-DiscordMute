import { describe, expect, it } from "vitest";
import { descriptionLocalizations, localeFrom, type MessageKey, t } from "../../src/i18n";
import { de } from "../../src/i18n/de";
import { en } from "../../src/i18n/en";

const placeholders = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe("t", () => {
    it("returns different texts per locale", () => {
        expect(t("de", "error.generic")).not.toBe(t("en", "error.generic"));
    });

    it("fills placeholders", () => {
        expect(t("en", "link.self.instructions", { phrase: "link-ABCD" })).toContain("link-ABCD");
        expect(t("de", "link.self.instructions", { phrase: "link-ABCD" })).toContain("link-ABCD");
    });

    it("keeps a missing placeholder literal", () => {
        expect(t("en", "link.self.instructions", {})).toContain("{phrase}");
    });

    it("does not expand placeholders inside parameter values", () => {
        expect(t("en", "link.alreadyLinked.body", { name: "{x}$&" })).toContain("{x}$&");
    });

    it("uses the same placeholders in every language and fits Discord description limits", () => {
        for (const key of Object.keys(en) as MessageKey[]) {
            expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
            if (key.endsWith(".description")) {
                expect(en[key].length, key).toBeLessThanOrEqual(100);
                expect(de[key].length, key).toBeLessThanOrEqual(100);
            }
        }
    });
});

describe("localeFrom", () => {
    it("maps german locales to de and everything else to en", () => {
        expect(localeFrom("de")).toBe("de");
        expect(localeFrom("de-AT")).toBe("de");
        expect(localeFrom("en-US")).toBe("en");
        expect(localeFrom("fr")).toBe("en");
        expect(localeFrom(undefined)).toBe("en");
        expect(localeFrom(null)).toBe("en");
    });
});

describe("descriptionLocalizations", () => {
    it("returns the german text", () => {
        expect(descriptionLocalizations("link.self.description")).toEqual({ de: de["link.self.description"] });
    });
});
