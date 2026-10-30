import { describe, expect, it } from "vitest";
import { EndedSessions } from "../../src/Utils/EndedSessions";

describe("EndedSessions", () => {
    it("remembers ended sessions and forgets the oldest beyond its capacity", () => {
        const ended = new EndedSessions(2);
        ended.add("a");
        ended.add("b");
        ended.add("a");
        ended.add("c");

        expect(ended.has("a")).toBe(true);
        expect(ended.has("b")).toBe(false);
        expect(ended.has("c")).toBe(true);
        expect(ended.has("never")).toBe(false);
    });
});
