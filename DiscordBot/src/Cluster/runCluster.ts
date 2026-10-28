import { type Client, Events } from "discord.js";
import { Cluster, ShardingUtil } from "galactic.ts";
import type { CommandContext } from "../commands/Command";
import { config, DISCORD_GUILD_ID } from "../config";
import { databaseOptionsFrom, openDatabase } from "../Data/database";
import { deployCommands } from "../deploy-commands";
import { logger, logModules } from "../Logging/logger";
import { MuteService } from "../Mute/MuteService";
import { createVoiceTargetResolver } from "../Mute/VoiceTargetResolver";
import { CLUSTER_EXIT_LOGIN_FAILED, loginFailureExitCode } from "../Process/processRole";
import { GalacticGatewayLink } from "../Routing/ClusterRouter";
import type { RouterReply } from "../Routing/messages";
import { LinkingService } from "../Utils/LinkingService";
import { createClusterRequestHandler } from "./clusterRequestHandler";
import { createDiscordClient } from "./createDiscordClient";
import { DiscordVoiceAdapter } from "./DiscordVoiceAdapter";
import { onFatalGatewayClose } from "./fatalGatewayClose";
import { registerInteractionHandlers } from "./interactionHandler";
import { updateOriginalLinkReply } from "./linkReply";
import { registerVoiceRejoin } from "./voiceRejoin";

const LOGIN_RETRY_DELAY_MS = 5000;

function failure(error: unknown): RouterReply {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function createCommandContext(gateway: GalacticGatewayLink, linking: LinkingService): CommandContext {
    return {
        linking,
        pushLinkPending: async (guildId, phrase, quickChatCode, discordId) =>
            (await gateway.send({ kind: "push-link-pending", guildId, phrase, quickChatCode, discordId })).ok,
        isPluginConnected: async (guildId) => (await gateway.send({ kind: "is-plugin-connected", guildId })).ok,
    };
}

async function onReady(
    client: Client<true>,
    cluster: Cluster<Client>,
    mute: MuteService,
    markReady: () => void,
): Promise<void> {
    logger.success(logModules.Discord, `Cluster ${cluster.clusterID} logged in as ${client.user.tag}`);
    // Only the cluster that owns the configured guild deploys, so several clusters never race on it.
    if (cluster.shardList.includes(ShardingUtil.getShardIDForGuild(DISCORD_GUILD_ID, cluster.totalShards))) {
        try {
            await deployCommands({ guildId: DISCORD_GUILD_ID, rest: client.rest });
        } catch (error) {
            logger.error(logModules.Command, "Failed to deploy commands during startup", error);
        }
    }
    // A respawned cluster has no active sessions in memory: recovery lifts every ledger mute and the next
    // game event of a running game mutes again.
    await mute.recover([...client.guilds.cache.keys()]);
    markReady();
    const members = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);
    cluster.triggerReady(client.guilds.cache.size, members);
}

/** A cluster process runs the Discord client for its shards and serves the requests the gateway routes to it. */
export async function runCluster(): Promise<void> {
    const cluster = Cluster.initial<Client>();
    // Ctrl+C and a process-group SIGTERM reach every process; the gateway alone drives shutdown so the clusters
    // still lift every mute. A cluster exits through SELF_DESTRUCT from the gateway or a lost IPC channel.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.removeAllListeners(signal);
        process.on(signal, () => {});
    }

    const client = createDiscordClient({ shards: cluster.shardList, shardCount: cluster.totalShards });
    cluster.client = client;

    const db = await openDatabase(databaseOptionsFrom(config), { migrate: false });
    const voice = new DiscordVoiceAdapter(client);
    const mute = new MuteService({
        voice,
        links: db.links,
        ledger: db.muteLedger,
        resolveTarget: createVoiceTargetResolver({
            links: db.links,
            memberVoiceChannel: (guildId, discordId) => voice.voiceChannelOf(guildId, discordId),
            fallbackChannelIds: config.channelIds,
        }),
    });

    let ready = false;
    const handleRequest = createClusterRequestHandler({
        mute,
        updateLinkReply: (link) => updateOriginalLinkReply(client.rest, link),
        isReady: () => ready,
    });
    cluster.on("request", (data, resolve) => {
        handleRequest(data).then(resolve, (error: unknown) => resolve(failure(error)));
    });

    registerInteractionHandlers(client, createCommandContext(new GalacticGatewayLink(cluster), new LinkingService(db)));
    registerVoiceRejoin(client, mute);
    client.once(Events.ClientReady, (readyClient) => {
        onReady(readyClient, cluster, mute, () => {
            ready = true;
        }).catch((error: unknown) =>
            logger.error(logModules.Bot, `Cluster ${cluster.clusterID} failed to finish starting`, error),
        );
    });

    const stop = async (): Promise<void> => {
        try {
            await client.destroy();
            await db.close();
        } catch (error) {
            logger.error(logModules.Bot, `Cluster ${cluster.clusterID} did not stop cleanly`, error);
        }
    };
    const stopAndExit = (exitCode: number): void => {
        void stop().finally(() => process.exit(exitCode));
    };
    cluster.onSelfDestruct = stop;
    // Without the IPC channel the gateway is gone; staying alive would leave an orphaned bot connected.
    process.once("disconnect", () => {
        logger.warn(logModules.Bot, `Cluster ${cluster.clusterID} lost the gateway, exiting`);
        stopAndExit(0);
    });

    let loggedIn = false;
    let fatalGatewayClose = false;
    onFatalGatewayClose(client, (message, shardId) => {
        logger.error(logModules.Discord, `Cluster ${cluster.clusterID} shard ${shardId}: ${message}`);
        fatalGatewayClose = true;
        // Before login resolves, the rejected login below handles the exit.
        if (loggedIn) stopAndExit(CLUSTER_EXIT_LOGIN_FAILED);
    });

    try {
        await client.login(cluster.token);
        loggedIn = true;
    } catch (error) {
        logger.error(logModules.Discord, `Cluster ${cluster.clusterID} failed to log in to Discord`, error);
        const exitCode = fatalGatewayClose ? CLUSTER_EXIT_LOGIN_FAILED : loginFailureExitCode(error);
        // galactic respawns at once, so a lasting outage would otherwise turn into a tight restart loop.
        if (exitCode !== CLUSTER_EXIT_LOGIN_FAILED)
            await new Promise((resolve) => setTimeout(resolve, LOGIN_RETRY_DELAY_MS));
        stopAndExit(exitCode);
    }
}
