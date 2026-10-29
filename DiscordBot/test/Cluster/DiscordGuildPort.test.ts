import { type Client, DiscordAPIError } from "discord.js";
import { describe, expect, it } from "vitest";
import { DiscordGuildPort, isUnknownGuildError, toGuildInfo } from "../../src/Cluster/DiscordGuildPort";

const apiError = (code: number, status: number) =>
    new DiscordAPIError({ code, message: "error" }, code, status, "GET", "/guilds/1", {});

describe("isUnknownGuildError", () => {
    it("is true only for Unknown Guild", () => {
        expect(isUnknownGuildError(apiError(10004, 404))).toBe(true);
        expect(isUnknownGuildError(apiError(50001, 403))).toBe(false);
        expect(isUnknownGuildError(apiError(0, 500))).toBe(false);
        expect(isUnknownGuildError(new Error("socket hang up"))).toBe(false);
    });
});

describe("toGuildInfo", () => {
    it("keeps the fields the hosted guild list stores", () => {
        const guild = { id: "1", name: "Crew", icon: null, ownerId: "2", memberCount: 3 };
        expect(toGuildInfo(guild)).toEqual({ guildId: "1", name: "Crew", icon: null, ownerId: "2", memberCount: 3 });
    });
});

describe("DiscordGuildPort", () => {
    const gone = (error: unknown) =>
        new DiscordGuildPort(
            {
                rest: {
                    get: async () => {
                        throw error;
                    },
                },
            } as unknown as Client,
            { shardList: [0], totalShards: 1 },
        ).isGone("1200000000000000001");

    it("reports a guild as gone only on Unknown Guild", async () => {
        expect(await gone(apiError(10004, 404))).toBe(true);
        expect(await gone(apiError(0, 503))).toBe(false);
        expect(await gone(new Error("timeout"))).toBe(false);
    });

    it("owns the guilds of its shards only", () => {
        const port = new DiscordGuildPort({} as Client, { shardList: [0], totalShards: 1 });
        expect(port.ownsGuild("1200000000000000001")).toBe(true);
        const other = new DiscordGuildPort({} as Client, { shardList: [], totalShards: 2 });
        expect(other.ownsGuild("1200000000000000001")).toBe(false);
    });

    it("says it was not in a guild it has not cached", async () => {
        const client = { guilds: { cache: new Map() } } as unknown as Client;
        expect(await new DiscordGuildPort(client, { shardList: [0], totalShards: 1 }).leave("1")).toBe(false);
    });
});
