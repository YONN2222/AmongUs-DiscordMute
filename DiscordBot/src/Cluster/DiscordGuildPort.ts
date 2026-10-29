import { type Client, type Guild, Routes } from "discord.js";
import { type Cluster, ShardingUtil } from "galactic.ts";
import type { GuildInfo, GuildPort } from "../Hosted/GuildLifecycle";

const GUILDS_PAGE_SIZE = 200;

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
        return this.client.guilds.cache.filter((guild) => guild.available).map(toGuildInfo);
    }

    cachedGuildIds(): string[] {
        return [...this.client.guilds.cache.keys()];
    }

    ownsGuild(guildId: string): boolean {
        return this.cluster.shardList.includes(ShardingUtil.getShardIDForGuild(guildId, this.cluster.totalShards));
    }

    async fetchMemberGuildIds(): Promise<Set<string>> {
        const ids = new Set<string>();
        let after: string | undefined;
        for (;;) {
            const query = new URLSearchParams({ limit: String(GUILDS_PAGE_SIZE) });
            if (after) query.set("after", after);
            const page = (await this.client.rest.get(Routes.userGuilds(), { query })) as { id: string }[];
            for (const guild of page) ids.add(guild.id);
            if (page.length < GUILDS_PAGE_SIZE) return ids;
            after = page[page.length - 1].id;
        }
    }
}
