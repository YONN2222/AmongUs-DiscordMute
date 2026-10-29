import { type Client, DiscordAPIError, type Guild } from "discord.js";
import { type Cluster, ShardingUtil } from "galactic.ts";
import type { GuildInfo, GuildPort } from "../Hosted/GuildLifecycle";

const DISCORD_UNKNOWN_GUILD = 10004;

/** Only this answer proves the guild is gone; a network error or a rate limit says nothing. */
export function isUnknownGuildError(error: unknown): boolean {
    return error instanceof DiscordAPIError && error.code === DISCORD_UNKNOWN_GUILD;
}

export function toGuildInfo(guild: Pick<Guild, "id" | "name" | "icon" | "ownerId" | "memberCount">): GuildInfo {
    return {
        guildId: guild.id,
        name: guild.name,
        icon: guild.icon,
        ownerId: guild.ownerId,
        memberCount: guild.memberCount,
    };
}

/** The Discord client of one cluster as a `GuildPort`. */
export class DiscordGuildPort implements GuildPort {
    constructor(
        private readonly client: Client,
        private readonly cluster: Pick<Cluster<Client>, "shardList" | "totalShards">,
    ) {}

    async leave(guildId: string): Promise<boolean> {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return false;
        await guild.leave();
        return true;
    }

    cachedGuilds(): GuildInfo[] {
        return this.client.guilds.cache.map(toGuildInfo);
    }

    ownsGuild(guildId: string): boolean {
        return this.cluster.shardList.includes(ShardingUtil.getShardIDForGuild(guildId, this.cluster.totalShards));
    }

    async isGone(guildId: string): Promise<boolean> {
        try {
            await this.client.rest.get(`/guilds/${guildId}`);
            return false;
        } catch (error) {
            return isUnknownGuildError(error);
        }
    }
}
