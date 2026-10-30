import { Client, GatewayIntentBits } from "discord.js";

export const DISCORD_INTENTS = ["Guilds", "GuildVoiceStates", "GuildMembers"] as const;

export interface ShardAssignment {
    shards: number[];
    shardCount: number;
}

export function createDiscordClient(assignment?: ShardAssignment): Client {
    return new Client({
        intents: DISCORD_INTENTS.map((intent) => GatewayIntentBits[intent]),
        ...(assignment ? { shards: assignment.shards, shardCount: assignment.shardCount } : {}),
    });
}
