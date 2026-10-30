import { describe, expect, it } from "vitest";
import { shardStats } from "../../src/Cluster/ShardStats";

const READY = 0;
const CONNECTING = 1;

describe("shard stats", () => {
    it("counts the guilds of every shard, sorted by shard id", () => {
        const shards = [
            { id: 3, status: READY, ping: 51, lastPingTimestamp: 2000 },
            { id: 2, status: READY, ping: 42, lastPingTimestamp: 1000 },
        ];

        expect(shardStats(shards, [2, 3, 3, 2, 3])).toEqual([
            { id: 2, status: READY, pingMs: 42, guilds: 2, lastPingAt: 1000 },
            { id: 3, status: READY, pingMs: 51, guilds: 3, lastPingAt: 2000 },
        ]);
    });

    it("a shard without guilds counts zero", () => {
        const shards = [{ id: 0, status: READY, ping: 30, lastPingTimestamp: 500 }];

        expect(shardStats(shards, [])[0]?.guilds).toBe(0);
    });

    it("a shard that has not sent a heartbeat yet has no ping", () => {
        const shards = [{ id: 1, status: CONNECTING, ping: -1, lastPingTimestamp: -1 }];

        expect(shardStats(shards, [1])).toEqual([
            { id: 1, status: CONNECTING, pingMs: null, guilds: 1, lastPingAt: null },
        ]);
    });
});
