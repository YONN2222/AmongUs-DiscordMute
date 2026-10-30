import type { ShardInfo } from "../Admin/Contract";

/** The parts of a discord.js WebSocketShard the admin API shows. */
export interface ShardState {
    id: number;
    status: number;
    ping: number;
    lastPingTimestamp: number;
}

/** discord.js reports -1 for ping and last ping until the shard's first heartbeat. */
const NOT_MEASURED = -1;

function measured(value: number): number | null {
    return value === NOT_MEASURED ? null : value;
}

/** One entry per shard with its guild count, taken from the shard id of every cached guild. */
export function shardStats(shards: Iterable<ShardState>, guildShardIds: Iterable<number>): ShardInfo[] {
    const guildsPerShard = new Map<number, number>();
    for (const shardId of guildShardIds) guildsPerShard.set(shardId, (guildsPerShard.get(shardId) ?? 0) + 1);
    return [...shards]
        .map((shard) => ({
            id: shard.id,
            status: shard.status,
            pingMs: measured(shard.ping),
            guilds: guildsPerShard.get(shard.id) ?? 0,
            lastPingAt: measured(shard.lastPingTimestamp),
        }))
        .sort((a, b) => a.id - b.id);
}
