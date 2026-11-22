import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../../src/Utils/SlidingWindowLimiter";

describe("SlidingWindowLimiter", () => {
    it("allows the limit within the window and refuses the next hit", () => {
        const limiter = new SlidingWindowLimiter<string>(2, 1000);

        expect(limiter.tryHit("a", 0)).toBe(true);
        expect(limiter.tryHit("a", 10)).toBe(true);
        expect(limiter.tryHit("a", 20)).toBe(false);
        expect(limiter.tryHit("b", 20)).toBe(true);
    });

    it("allows the key again once its oldest hit left the window", () => {
        const limiter = new SlidingWindowLimiter<string>(1, 1000);

        expect(limiter.tryHit("a", 0)).toBe(true);
        expect(limiter.tryHit("a", 999)).toBe(false);
        expect(limiter.tryHit("a", 1000)).toBe(true);
    });

    it("forgets a key on request", () => {
        const limiter = new SlidingWindowLimiter<string>(1, 1000);

        limiter.tryHit("a", 0);
        limiter.forget("a");
        expect(limiter.tryHit("a", 1)).toBe(true);
    });
});
