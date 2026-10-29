import { describe, expect, it } from "vitest";
import { BoundedLabelSet, MAX_VERSION_LABELS, sanitizeVersionLabel } from "../../src/Metrics/labels";

describe("sanitizeVersionLabel", () => {
    it("keeps 2026.3.31 and 3.0.0-beta.1", () => {
        expect(sanitizeVersionLabel("2026.3.31")).toBe("2026.3.31");
        expect(sanitizeVersionLabel(" 3.0.0-beta.1 ")).toBe("3.0.0-beta.1");
    });

    it('maps "Some Player Name", "-1.0" and "" to other', () => {
        expect(sanitizeVersionLabel("Some Player Name")).toBe("other");
        expect(sanitizeVersionLabel("-1.0")).toBe("other");
        expect(sanitizeVersionLabel("")).toBe("other");
        expect(sanitizeVersionLabel("1".repeat(33))).toBe("other");
    });
});

describe("BoundedLabelSet", () => {
    it("admits at most 15 values then other", () => {
        const set = new BoundedLabelSet(MAX_VERSION_LABELS);
        for (let i = 0; i < MAX_VERSION_LABELS; i++) expect(set.admit(`1.${i}`)).toBe(`1.${i}`);
        expect(set.admit("2.0")).toBe("other");
    });

    it("an admitted value stays admitted when full", () => {
        const set = new BoundedLabelSet(2);
        set.admit("a");
        set.admit("b");
        expect(set.admit("c")).toBe("other");
        expect(set.admit("a")).toBe("a");
    });
});
