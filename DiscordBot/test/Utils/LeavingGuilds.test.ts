import { describe, expect, it } from "vitest";
import { LeavingGuilds } from "../../src/Utils/LeavingGuilds";

describe("LeavingGuilds", () => {
    it("marks a guild as leaving until every leave that entered has exited", () => {
        const leaving = new LeavingGuilds();
        leaving.enter("g1");
        leaving.enter("g1");

        leaving.exit("g1");
        expect(leaving.has("g1")).toBe(true);

        leaving.exit("g1");
        expect(leaving.has("g1")).toBe(false);
    });

    it("keeps guilds apart and ignores an exit without an enter", () => {
        const leaving = new LeavingGuilds();
        leaving.enter("g1");
        leaving.exit("g2");

        expect(leaving.has("g1")).toBe(true);
        expect(leaving.has("g2")).toBe(false);
        leaving.enter("g2");
        expect(leaving.has("g2")).toBe(true);
    });
});
