import type { Client } from "discord.js";

/** The guilds of this cluster's shards that the client currently knows. */
export function cachedGuildIds(client: Client): string[] {
    return [...client.guilds.cache.keys()];
}
