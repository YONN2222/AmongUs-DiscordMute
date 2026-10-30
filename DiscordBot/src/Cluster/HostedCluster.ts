import { type Client, Events } from "discord.js";
import type { Cluster } from "galactic.ts";
import type { HostedCommandContext } from "../Commands/Command";
import type { Database } from "../Data/Database";
import { BlockChecker } from "../Hosted/BlockChecker";
import { type BlockLeaveReason, type GuildGames, GuildLifecycle } from "../Hosted/GuildLifecycle";
import { LEAVE_DISCONNECTS, REMOVED_DISCONNECT } from "../Hosted/LeaveDisconnects";
import { logger, logModules } from "../Logging/Logger";
import type { GatewayLink } from "../Routing/ClusterRouter";
import { DiscordGuildPort, toGuildInfo } from "./DiscordGuildPort";
import { createGuildDisconnect } from "./GuildDisconnect";

type PluginDisconnect = (typeof LEAVE_DISCONNECTS)[BlockLeaveReason] | typeof REMOVED_DISCONNECT;

/** What a cluster adds in hosted mode; none of it exists in self-host. */
export interface HostedCluster {
    blocks: BlockChecker;
    commands: HostedCommandContext;
    lifecycle: GuildLifecycle;
}

export function createHostedCluster(deps: {
    db: Database;
    client: Client;
    cluster: Pick<Cluster<Client>, "shardList" | "totalShards">;
    gateway: GatewayLink;
    games: GuildGames;
}): HostedCluster {
    const { db, gateway } = deps;
    const sendDisconnect = createGuildDisconnect(gateway);
    const disconnectPlugins = async (guildId: string, { code, reason }: PluginDisconnect) => {
        if (!(await sendDisconnect(guildId, code, reason)))
            logger.warn(logModules.Bot, `Guild ${guildId}: could not disconnect its plugins`);
    };
    const blocks = new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds });
    return {
        blocks,
        commands: {
            secrets: db.guildSecrets,
            audit: db.audit,
            blocks,
            disconnectGuild: sendDisconnect,
        },
        lifecycle: new GuildLifecycle({
            port: new DiscordGuildPort(deps.client, deps.cluster),
            hostedGuilds: db.hostedGuilds,
            blocks,
            audit: db.audit,
            games: deps.games,
            disconnectBlocked: (guildId, reason: BlockLeaveReason) =>
                disconnectPlugins(guildId, LEAVE_DISCONNECTS[reason]),
            disconnectRemoved: (guildId) => disconnectPlugins(guildId, REMOVED_DISCONNECT),
        }),
    };
}

function logLifecycleFailure(guildId: string, error: unknown): void {
    logger.error(logModules.Bot, `Guild ${guildId}: updating the hosted guild list failed`, error);
}

/** Keeps the hosted guild list in step with Discord while the cluster runs. */
export function bindGuildLifecycle(client: Client, lifecycle: GuildLifecycle): void {
    client.on(Events.GuildCreate, (guild) => {
        lifecycle.onGuildCreate(toGuildInfo(guild)).catch((error: unknown) => logLifecycleFailure(guild.id, error));
    });
    client.on(Events.GuildUpdate, (_old, guild) => {
        lifecycle.onGuildUpdate(toGuildInfo(guild)).catch((error: unknown) => logLifecycleFailure(guild.id, error));
    });
    client.on(Events.GuildDelete, (guild) => {
        // An outage makes a guild unavailable without removing the bot; its data must stay.
        if (guild.available === false) return;
        lifecycle.onGuildDelete(guild.id).catch((error: unknown) => logLifecycleFailure(guild.id, error));
    });
}
