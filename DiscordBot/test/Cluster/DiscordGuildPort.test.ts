import { type Client, Collection } from "discord.js";
import { describe, expect, it } from "vitest";
import { DiscordGuildPort, toGuildInfo } from "../../src/Cluster/DiscordGuildPort";

const SHARDS = { shardList: [0], totalShards: 1 };

type Page = { id: string }[];

function clientWith(options: { cache?: Collection<string, unknown>; pages?: Page[]; failAtPage?: number }): {
    client: Client;
    afters: (string | undefined)[];
} {
    const afters: (string | undefined)[] = [];
    const client = {
        guilds: { cache: options.cache ?? new Collection() },
        rest: {
            get: async (_route: string, init: { query: URLSearchParams }) => {
                afters.push(init.query.get("after") ?? undefined);
                if (options.failAtPage === afters.length) throw new Error("discord down");
                return options.pages?.[afters.length - 1] ?? [];
            },
        },
    } as unknown as Client;
    return { client, afters };
}

const guildPage = (from: number, count: number): Page =>
    Array.from({ length: count }, (_, i) => ({ id: String(from + i) }));

describe("toGuildInfo", () => {
    it("keeps the fields the hosted guild list stores", () => {
        const guild = { id: "1", name: "Crew", icon: null, ownerId: "2", memberCount: 3 };
        expect(toGuildInfo(guild)).toEqual({ guildId: "1", name: "Crew", icon: null, ownerId: "2", memberCount: 3 });
    });
});

describe("DiscordGuildPort", () => {
    it("owns the guilds of its shards only", () => {
        const port = new DiscordGuildPort({} as Client, SHARDS);
        expect(port.ownsGuild("1200000000000000001")).toBe(true);
        const other = new DiscordGuildPort({} as Client, { shardList: [], totalShards: 2 });
        expect(other.ownsGuild("1200000000000000001")).toBe(false);
    });

    it("says it was not in a guild it has not cached", async () => {
        const { client } = clientWith({});
        expect(await new DiscordGuildPort(client, SHARDS).leave("1")).toBe(false);
    });

    it("lists only available guilds for tracking but every cached id for protection", () => {
        const available = { id: "1", available: true, name: "A", icon: null, ownerId: "9", memberCount: 2 };
        const unavailable = { id: "2", available: false };
        const cache = new Collection<string, unknown>([
            ["1", available],
            ["2", unavailable],
        ]);
        const port = new DiscordGuildPort(clientWith({ cache }).client, SHARDS);

        expect(port.cachedGuilds().map((info) => info.guildId)).toEqual(["1"]);
        expect(port.cachedGuildIds()).toEqual(["1", "2"]);
    });

    describe("fetchMemberGuildIds", () => {
        it("reads every page of the guild list", async () => {
            const { client, afters } = clientWith({ pages: [guildPage(1, 200), guildPage(201, 3)] });

            const ids = await new DiscordGuildPort(client, SHARDS).fetchMemberGuildIds();

            expect(ids.size).toBe(203);
            expect(ids.has("203")).toBe(true);
            expect(afters).toEqual([undefined, "200"]);
        });

        it("stops after a short page", async () => {
            const { client, afters } = clientWith({ pages: [guildPage(1, 5)] });

            expect((await new DiscordGuildPort(client, SHARDS).fetchMemberGuildIds()).size).toBe(5);
            expect(afters).toHaveLength(1);
        });

        it("fails when a page cannot be read, so no partial list is used", async () => {
            const { client } = clientWith({ pages: [guildPage(1, 200)], failAtPage: 2 });

            await expect(new DiscordGuildPort(client, SHARDS).fetchMemberGuildIds()).rejects.toThrow("discord down");
        });
    });
});
