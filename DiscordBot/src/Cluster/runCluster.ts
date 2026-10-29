import { type Client, Events } from "discord.js";
import { Cluster, ShardingUtil } from "galactic.ts";
import type { CommandContext } from "../commands/Command";
import { config, DISCORD_GUILD_ID } from "../config";
import { databaseOptionsFrom, openDatabase } from "../Data/database";
import { deployCommands } from "../deploy-commands";
import { GuildEventBus } from "../Events/GuildEvents";
import { NicknameSync } from "../Game/NicknameSync";
import { SHUTDOWN_SIGNALS } from "../Gateway/shutdown";
import { LinkOverviewPublisher } from "../LinkOverview/LinkOverviewPublisher";
import { LogChannelWriter } from "../LogChannel/LogChannelWriter";
import { logger, logModules } from "../Logging/logger";
import { MuteService } from "../Mute/MuteService";
import { createVoiceTargetResolver } from "../Mute/VoiceTargetResolver";
import { CLUSTER_EXIT_LOGIN_FAILED, loginFailureExitCode } from "../Process/processRole";
import { GalacticGatewayLink } from "../Routing/ClusterRouter";
import type { RouterReply } from "../Routing/messages";
import { SettingsService } from "../Settings/SettingsService";
import { LinkingService } from "../Utils/LinkingService";
import { createClusterRequestHandler } from "./clusterRequestHandler";
import { createDiscordClient } from "./createDiscordClient";
import { DiscordVoiceAdapter } from "./DiscordVoiceAdapter";
import { onFatalGatewayClose } from "./fatalGatewayClose";
import { registerInteractionHandlers } from "./interactionHandler";
import { resolveLinkReplyLocale, updateOriginalLinkReply } from "./linkReply";
import { createDiscordMessagePort } from "./messagePort";
import { registerVoiceRejoin } from "./voiceRejoin";

const LOGIN_RETRY_DELAY_MS = 5000;
const IDLE_SWEEP_INTERVAL_MS = 60_000;

function failure(error: unknown): RouterReply {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function createCommandContext(
    gateway: GalacticGatewayLink,
    linking: LinkingService,
    events: GuildEventBus,
    settings: SettingsService,
): CommandContext {
    return {
        linking,
        events,
        settings,
        pushLinkPending: async (guildId, phrase, quickChatCode, discordId) =>
            (await gateway.send({ kind: "push-link-pending", guildId, phrase, quickChatCode, discordId })).ok,
        isPluginConnected: async (guildId) => (await gateway.send({ kind: "is-plugin-connected", guildId })).ok,
    };
}

async function onReady(
    client: Client<true>,
    cluster: Cluster<Client>,
    mute: MuteService,
    nicknameSync: NicknameSync,
    overview: LinkOverviewPublisher,
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
    await nicknameSync.recover([...client.guilds.cache.keys()]).catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not restore nicknames`, error);
    });
    overview.resume([...client.guilds.cache.keys()]).catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not refresh the link overviews`, error);
    });
    markReady();
    const members = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);
    cluster.triggerReady(client.guilds.cache.size, members);
}

/** A cluster process runs the Discord client for its shards and serves the requests the gateway routes to it. */
export async function runCluster(): Promise<void> {
    const cluster = Cluster.initial<Client>();
    // Ctrl+C, a process-group SIGTERM and closing the console reach every process; the gateway alone drives
    // shutdown so the clusters still lift every mute. A cluster exits through SELF_DESTRUCT from the gateway or a
    // lost IPC channel.
    for (const signal of SHUTDOWN_SIGNALS) {
        process.removeAllListeners(signal);
        process.on(signal, () => {});
    }

    const client = createDiscordClient({ shards: cluster.shardList, shardCount: cluster.totalShards });
    cluster.client = client;

    const db = await openDatabase(databaseOptionsFrom(config), { migrate: false });
    const events = new GuildEventBus();
    const settings = new SettingsService(db.settings, events);
    const guildLanguage = (guildId: string) => settings.get(guildId).then((s) => s.language);
    const messagePort = createDiscordMessagePort(client);
    const logWriter = new LogChannelWriter({ port: messagePort, settings });
    events.on((event) => logWriter.handle(event));
    const overview = new LinkOverviewPublisher({
        port: messagePort,
        links: db.links,
        pending: db.pendingLinks,
        tracked: db.trackedMessages,
        settings,
    });
    events.on((event) => overview.handle(event));
    const voice = new DiscordVoiceAdapter(client);
    const nicknameSync = new NicknameSync({
        adapter: voice,
        ledger: db.nicknameLedger,
        links: db.links,
        settings,
        events,
    });
    events.on((event) => nicknameSync.handle(event));
    const mute = new MuteService({
        events,
        voice,
        settings,
        links: db.links,
        ledger: db.muteLedger,
        resolveTarget: createVoiceTargetResolver({
            links: db.links,
            memberVoiceChannel: (guildId, discordId) => voice.voiceChannelOf(guildId, discordId),
            fallbackChannelIds: config.channelIds,
            localeOf: guildLanguage,
        }),
    });

    let ready = false;
    const sweepTimer = setInterval(() => {
        if (!ready) return;
        mute.sweepIdle([...client.guilds.cache.keys()]).catch((error: unknown) => {
            logger.error(logModules.Mute, `Cluster ${cluster.clusterID} could not sweep leftover mutes`, error);
        });
    }, IDLE_SWEEP_INTERVAL_MS);
    sweepTimer.unref();
    const handleRequest = createClusterRequestHandler({
        mute,
        updateLinkReply: async (link) =>
            updateOriginalLinkReply(client.rest, link, await resolveLinkReplyLocale(link, guildLanguage)),
        isReady: () => ready,
        events,
        links: db.links,
        settings,
        nicknames: nicknameSync,
    });
    cluster.on("request", (data, resolve) => {
        handleRequest(data).then(resolve, (error: unknown) => resolve(failure(error)));
    });

    registerInteractionHandlers(
        client,
        createCommandContext(new GalacticGatewayLink(cluster), new LinkingService(db, events), events, settings),
    );
    registerVoiceRejoin(client, mute);
    client.once(Events.ClientReady, (readyClient) => {
        onReady(readyClient, cluster, mute, nicknameSync, overview, () => {
            ready = true;
        }).catch((error: unknown) =>
            logger.error(logModules.Bot, `Cluster ${cluster.clusterID} failed to finish starting`, error),
        );
    });

    const stop = async (): Promise<void> => {
        clearInterval(sweepTimer);
        try {
            await logWriter.flushAll();
        } catch (error) {
            logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not flush the log channel`, error);
        }
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
