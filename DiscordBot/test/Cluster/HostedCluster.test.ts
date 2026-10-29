import { EventEmitter } from "node:events";
import { type Client, Events } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindGuildLifecycle, createHostedCluster } from "../../src/Cluster/HostedCluster";
import type { Database } from "../../src/Data/Database";
import type { GuildLifecycle } from "../../src/Hosted/GuildLifecycle";
import { CLOSE_BLOCKED } from "../../src/Protocol/PluginProtocol";
import { InMemoryGatewayLink } from "../../src/Routing/ClusterRouter";
import { createTestDatabase } from "../Helpers/TestDatabase";

const SHARDS = { shardList: [0], totalShards: 1 };
const GUILD = { id: "1200000000000000001", name: "Crew", icon: null, ownerId: "1200000000000000002", memberCount: 4 };

function fakeLifecycle() {
    return {
        onGuildCreate: vi.fn(async () => {}),
        onGuildUpdate: vi.fn(async () => {}),
        onGuildDelete: vi.fn(async () => {}),
    };
}

describe("bindGuildLifecycle", () => {
    let client: EventEmitter;
    let lifecycle: ReturnType<typeof fakeLifecycle>;

    beforeEach(() => {
        client = new EventEmitter();
        lifecycle = fakeLifecycle();
        bindGuildLifecycle(client as unknown as Client, lifecycle as unknown as GuildLifecycle);
    });

    it("tracks joined and updated guilds", () => {
        client.emit(Events.GuildCreate, GUILD);
        client.emit(Events.GuildUpdate, GUILD, { ...GUILD, name: "Renamed" });

        expect(lifecycle.onGuildCreate).toHaveBeenCalledWith({
            guildId: GUILD.id,
            name: "Crew",
            icon: null,
            ownerId: GUILD.ownerId,
            memberCount: 4,
        });
        expect(lifecycle.onGuildUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed" }));
    });

    it("purges a guild the bot was removed from", () => {
        client.emit(Events.GuildDelete, { id: GUILD.id, available: true });
        expect(lifecycle.onGuildDelete).toHaveBeenCalledWith(GUILD.id);
    });

    it("keeps the data of a guild that only became unavailable", () => {
        client.emit(Events.GuildDelete, { id: GUILD.id, available: false });
        expect(lifecycle.onGuildDelete).not.toHaveBeenCalled();
    });
});

describe("createHostedCluster", () => {
    let db: Database;

    const games = { end: async () => {}, reopen: () => {} };

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    afterEach(async () => {
        await db.close();
    });

    it("disconnects a guild's plugins through the gateway", async () => {
        const gateway = new InMemoryGatewayLink();
        gateway.register(GUILD.id, async () => ({ ok: true }));
        const hosted = createHostedCluster({ db, client: {} as Client, cluster: SHARDS, gateway, games });

        expect(await hosted.commands.disconnectGuild(GUILD.id, CLOSE_BLOCKED, "Blocked")).toBe(true);
        expect(gateway.sent).toEqual([
            { kind: "disconnect-guild", guildId: GUILD.id, code: CLOSE_BLOCKED, reason: "Blocked" },
        ]);
    });

    it("reports a failed disconnect as false", async () => {
        const hosted = createHostedCluster({
            db,
            client: {} as Client,
            cluster: SHARDS,
            gateway: new InMemoryGatewayLink(),
            games,
        });
        expect(await hosted.commands.disconnectGuild(GUILD.id, CLOSE_BLOCKED, "Blocked")).toBe(false);
    });
});
