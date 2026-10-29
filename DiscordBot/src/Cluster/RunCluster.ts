import { type Client, Events } from "discord.js";
import { Cluster, ShardingUtil } from "galactic.ts";
import { Registry } from "prom-client";
import { isClusterInfoRequest } from "../Admin/ClusterInfo";
import type { CommandContext } from "../Commands/Command";
import { config } from "../Config/LoadedConfig";
import { databaseOptionsFrom, openDatabase } from "../Data/Database";
import { deployCommands } from "../DeployCommands";
import { GuildEventBus } from "../Events/GuildEvents";
import { MatchSummary } from "../Game/MatchSummary";
import { NicknameSync } from "../Game/NicknameSync";
import { StatusMessage } from "../Game/StatusMessage";
import { sweepTrackedMessages } from "../Game/TrackedMessageSweeper";
import { SHUTDOWN_SIGNALS } from "../Gateway/Shutdown";
import type { GuildLifecycle } from "../Hosted/GuildLifecycle";
import { isHosted } from "../Hosted/HostedMode";
import { LinkingService } from "../Linking/LinkingService";
import { LinkOverviewPublisher } from "../LinkOverview/LinkOverviewPublisher";
import { LogChannelWriter } from "../LogChannel/LogChannelWriter";
import { configureLogger, logger, logModules } from "../Logging/Logger";
import { createClusterMetrics, instrumentVoiceAdapter, registerDiscordMetrics } from "../Metrics/ClusterMetrics";
import { isMetricsSnapshotRequest } from "../Metrics/SnapshotMessages";
import { MuteService } from "../Mute/MuteService";
import { createVoiceTargetResolver } from "../Mute/VoiceTargetResolver";
import { EXIT_CONFIG } from "../Process/ExitCodes";
import { loginFailureExitCode } from "../Process/ProcessRole";
import { GalacticGatewayLink } from "../Routing/ClusterRouter";
import type { RouterReply } from "../Routing/Messages";
import { SettingsService } from "../Settings/SettingsService";
import { createClusterRequestHandler } from "./ClusterRequestHandler";
import { createDiscordClient } from "./CreateDiscordClient";
import { DiscordVoiceAdapter } from "./DiscordVoiceAdapter";
import { onFatalGatewayClose } from "./FatalGatewayClose";
import { bindGuildLifecycle, createHostedCluster, type HostedCluster } from "./HostedCluster";
import { registerInteractionHandlers } from "./InteractionHandler";
import { resolveLinkReplyLocale, updateOriginalLinkReply } from "./LinkReply";
import { createDiscordMessagePort } from "./MessagePort";
import { registerVoiceRejoin } from "./VoiceRejoin";

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
    hosted: HostedCluster | undefined,
): CommandContext {
    return {
        linking,
        events,
        settings,
        hosted: hosted?.commands,
        pushLinkPending: async (guildId, phrase, quickChatCode, discordId) =>
            (await gateway.send({ kind: "push-link-pending", guildId, phrase, quickChatCode, discordId })).ok,
        isPluginConnected: async (guildId) => (await gateway.send({ kind: "is-plugin-connected", guildId })).ok,
    };
}

/**
 * Hosted publishes the commands globally from cluster 0; self-host deploys to the configured guild from the
 * cluster that owns it. Either way a single cluster deploys, so clusters never race on it.
 */
function startupDeployTarget(cluster: Cluster<Client>): { guildId: string } | "global" | null {
    if (isHosted(config)) return cluster.clusterID === 0 ? "global" : null;
    const guildId = config.guildId;
    if (!guildId) return null;
    return cluster.shardList.includes(ShardingUtil.getShardIDForGuild(guildId, cluster.totalShards))
        ? { guildId }
        : null;
}

async function onReady(
    client: Client<true>,
    cluster: Cluster<Client>,
    mute: MuteService,
    nicknameSync: NicknameSync,
    overview: LinkOverviewPublisher,
    status: StatusMessage,
    lifecycle: GuildLifecycle | undefined,
    markReady: () => void,
): Promise<void> {
    logger.success(logModules.Discord, `Cluster ${cluster.clusterID} logged in as ${client.user.tag}`);
    const target = startupDeployTarget(cluster);
    if (target) {
        try {
            await deployCommands({ target, rest: client.rest });
        } catch (error) {
            logger.error(logModules.Command, "Failed to deploy commands during startup", error);
        }
    }
    // A respawned cluster has no active sessions in memory: recovery lifts every ledger mute and the next
    // game event of a running game mutes again.
    await mute.recover([...client.guilds.cache.keys()]);
    lifecycle?.reconcile().catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not reconcile the hosted guild list`, error);
    });
    await nicknameSync.recover([...client.guilds.cache.keys()]).catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not restore nicknames`, error);
    });
    await status.recover([...client.guilds.cache.keys()]).catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not remove leftover status messages`, error);
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
    configureLogger({ format: config.logFormat, processName: `cluster-${cluster.clusterID}` });
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
    const gateway = new GalacticGatewayLink(cluster);
    const hosted = isHosted(config)
        ? createHostedCluster({
              db,
              client,
              cluster,
              gateway,
              games: { end: endGames, reopen: reopenGames, forget: forgetGames, recover: recoverGames },
          })
        : undefined;
    const registry = new Registry();
    const metrics = createClusterMetrics(registry, cluster.clusterID);
    registerDiscordMetrics(client, metrics);
    const events = new GuildEventBus();
    const settings = new SettingsService(db.settings, events);
    metrics.attachFeatureSource({
        guildIds: () => [...client.guilds.cache.keys()],
        settings: (guildId) => settings.get(guildId),
    });
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
    const status = new StatusMessage({
        port: messagePort,
        tracked: db.trackedMessages,
        links: db.links,
        settings,
    });
    events.on((event) => status.handle(event));
    const summary = new MatchSummary({
        port: messagePort,
        tracked: db.trackedMessages,
        links: db.links,
        settings,
    });
    events.on((event) => summary.handle(event));
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
        voice: instrumentVoiceAdapter(voice, metrics),
        settings,
        links: db.links,
        ledger: db.muteLedger,
        resolveTarget: createVoiceTargetResolver({
            links: db.links,
            memberVoiceChannel: (guildId, discordId) => voice.voiceChannelOf(guildId, discordId),
            // Hosted servers pick their fallback channels in /setup; self-host keeps them in config.json.
            fallbackChannelIds: hosted
                ? async (guildId) => (await settings.get(guildId)).voiceChannelIds
                : async () => config.channelIds,
            isUserBlocked: hosted ? (userId) => hosted.blocks.isUserBlocked(userId) : undefined,
            localeOf: guildLanguage,
        }),
    });

    // The hosted lifecycle calls these when the bot leaves, is removed from or is added to a guild.
    async function endGames(guildId: string): Promise<void> {
        await mute.endGuild(guildId);
        await nicknameSync.endGuild(guildId);
    }

    function reopenGames(guildId: string): void {
        mute.reopenGuild(guildId);
        nicknameSync.reopenGuild(guildId);
    }

    function forgetGames(guildId: string): void {
        mute.forgetGuild(guildId);
        nicknameSync.forgetGuild(guildId);
    }

    async function recoverGames(guildId: string): Promise<void> {
        await mute.recover([guildId]);
        await nicknameSync.recover([guildId]);
    }

    let ready = false;
    const sweepTimer = setInterval(() => {
        if (!ready) return;
        mute.sweepIdle([...client.guilds.cache.keys()]).catch((error: unknown) => {
            logger.error(logModules.Mute, `Cluster ${cluster.clusterID} could not sweep leftover mutes`, error);
        });
        sweepTrackedMessages(
            { port: messagePort, tracked: db.trackedMessages },
            [...client.guilds.cache.keys()],
            Date.now(),
        ).catch((error: unknown) => {
            logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not delete expired messages`, error);
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
        lifecycle: hosted?.lifecycle,
    });
    cluster.on("request", (data, resolve) => {
        if (isClusterInfoRequest(data)) {
            resolve({ ok: true, id: cluster.clusterID, guilds: client.guilds.cache.size, wsPingMs: client.ws.ping });
            return;
        }
        if (isMetricsSnapshotRequest(data)) {
            registry.getMetricsAsJSON().then(
                (m) => resolve({ ok: true, source: `cluster-${cluster.clusterID}`, metrics: m }),
                (e: unknown) => resolve(failure(e)),
            );
            return;
        }
        handleRequest(data).then(resolve, (error: unknown) => resolve(failure(error)));
    });

    registerInteractionHandlers(
        client,
        createCommandContext(gateway, new LinkingService(db, events, hosted?.blocks), events, settings, hosted),
    );
    registerVoiceRejoin(client, mute);
    if (hosted) bindGuildLifecycle(client, hosted.lifecycle);
    client.once(Events.ClientReady, (readyClient) => {
        onReady(readyClient, cluster, mute, nicknameSync, overview, status, hosted?.lifecycle, () => {
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
        if (loggedIn) stopAndExit(EXIT_CONFIG);
    });

    try {
        await client.login(cluster.token);
        loggedIn = true;
    } catch (error) {
        logger.error(logModules.Discord, `Cluster ${cluster.clusterID} failed to log in to Discord`, error);
        const exitCode = fatalGatewayClose ? EXIT_CONFIG : loginFailureExitCode(error);
        // galactic respawns at once, so a lasting outage would otherwise turn into a tight restart loop.
        if (exitCode !== EXIT_CONFIG) await new Promise((resolve) => setTimeout(resolve, LOGIN_RETRY_DELAY_MS));
        stopAndExit(exitCode);
    }
}
