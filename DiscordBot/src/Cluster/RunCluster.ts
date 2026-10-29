import { type Client, Events } from "discord.js";
import { Cluster, ShardingUtil } from "galactic.ts";
import { Registry } from "prom-client";
import type { CommandContext } from "../Commands/Command";
import { config } from "../Config/LoadedConfig";
import { type Database, databaseOptionsFrom, openDatabase } from "../Data/Database";
import { deployCommands } from "../DeployCommands";
import type { GuildEventBus } from "../Events/GuildEvents";
import { sweepTrackedMessages } from "../Game/TrackedMessageSweeper";
import { SHUTDOWN_SIGNALS } from "../Gateway/Shutdown";
import type { GuildLifecycle } from "../Hosted/GuildLifecycle";
import { isHosted } from "../Hosted/HostedMode";
import { LinkingService } from "../Linking/LinkingService";
import { configureLogger, logger, logModules } from "../Logging/Logger";
import { createClusterMetrics, registerDiscordMetrics } from "../Metrics/ClusterMetrics";
import { EXIT_CONFIG } from "../Process/ExitCodes";
import { loginFailureExitCode } from "../Process/ProcessRole";
import { GalacticGatewayLink } from "../Routing/ClusterRouter";
import type { RouterReply } from "../Routing/Messages";
import type { SettingsService } from "../Settings/SettingsService";
import { cachedGuildIds } from "./CachedGuildIds";
import { createClusterRequestHandler } from "./ClusterRequestHandler";
import { type ClusterServices, createClusterServices } from "./ClusterServices";
import { createDiscordClient } from "./CreateDiscordClient";
import { onFatalGatewayClose } from "./FatalGatewayClose";
import { bindGuildLifecycle, createHostedCluster, type HostedCluster } from "./HostedCluster";
import { registerInteractionHandlers } from "./InteractionHandler";
import { resolveLinkReplyLocale, updateOriginalLinkReply } from "./LinkReply";
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

interface ReadyDeps {
    client: Client<true>;
    cluster: Cluster<Client>;
    services: Pick<ClusterServices, "mute" | "nicknameSync" | "overview" | "status">;
    lifecycle: GuildLifecycle | undefined;
    markReady: () => void;
}

async function onReady({ client, cluster, services, lifecycle, markReady }: ReadyDeps): Promise<void> {
    const { mute, nicknameSync, overview, status } = services;
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
    await mute.recover(cachedGuildIds(client));
    lifecycle?.reconcile().catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not reconcile the hosted guild list`, error);
    });
    await nicknameSync.recover(cachedGuildIds(client)).catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not restore nicknames`, error);
    });
    await status.recover(cachedGuildIds(client)).catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not remove leftover status messages`, error);
    });
    overview.resume(cachedGuildIds(client)).catch((error: unknown) => {
        logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not refresh the link overviews`, error);
    });
    markReady();
    const members = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);
    cluster.triggerReady(client.guilds.cache.size, members);
}

interface IdleSweepDeps {
    cluster: Cluster<Client>;
    client: Client;
    db: Database;
    services: Pick<ClusterServices, "mute" | "messagePort">;
    isReady: () => boolean;
}

/** Lifts leftover mutes and deletes expired tracked messages every minute once the cluster is ready. */
function startIdleSweeps({ cluster, client, db, services, isReady }: IdleSweepDeps): NodeJS.Timeout {
    const sweepTimer = setInterval(() => {
        if (!isReady()) return;
        services.mute.sweepIdle(cachedGuildIds(client)).catch((error: unknown) => {
            logger.error(logModules.Mute, `Cluster ${cluster.clusterID} could not sweep leftover mutes`, error);
        });
        sweepTrackedMessages(
            { port: services.messagePort, tracked: db.trackedMessages },
            cachedGuildIds(client),
            Date.now(),
        ).catch((error: unknown) => {
            logger.error(logModules.Bot, `Cluster ${cluster.clusterID} could not delete expired messages`, error);
        });
    }, IDLE_SWEEP_INTERVAL_MS);
    sweepTimer.unref();
    return sweepTimer;
}

interface GatewayRequestDeps {
    cluster: Cluster<Client>;
    client: Client;
    db: Database;
    registry: Registry;
    services: ClusterServices;
    hosted: HostedCluster | undefined;
    isReady: () => boolean;
}

function serveGatewayRequests({ cluster, client, db, registry, services, hosted, isReady }: GatewayRequestDeps): void {
    const handleRequest = createClusterRequestHandler({
        mute: services.mute,
        updateLinkReply: async (link) =>
            updateOriginalLinkReply(client.rest, link, await resolveLinkReplyLocale(link, services.guildLanguage)),
        isReady,
        events: services.events,
        links: db.links,
        settings: services.settings,
        nicknames: services.nicknameSync,
        lifecycle: hosted?.lifecycle,
        clusterInfo: () => ({
            ok: true,
            id: cluster.clusterID,
            guilds: client.guilds.cache.size,
            wsPingMs: client.ws.ping,
        }),
        metricsSnapshot: async () => ({
            ok: true,
            source: `cluster-${cluster.clusterID}`,
            metrics: await registry.getMetricsAsJSON(),
        }),
    });
    cluster.on("request", (data, resolve) => {
        handleRequest(data).then(resolve, (error: unknown) => resolve(failure(error)));
    });
}

interface StopDeps {
    cluster: Cluster<Client>;
    client: Client;
    db: Database;
    logWriter: ClusterServices["logWriter"];
    sweepTimer: NodeJS.Timeout;
}

/** Flushes the log channel first, then disconnects from Discord and closes the database. */
function createStop({ cluster, client, db, logWriter, sweepTimer }: StopDeps): () => Promise<void> {
    return async () => {
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
}

/** Logs in; when Discord refuses the bot for good the cluster exits with EXIT_CONFIG so it is not respawned. */
async function logInOrExit(
    client: Client,
    cluster: Cluster<Client>,
    stopAndExit: (exitCode: number) => void,
): Promise<void> {
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
    const services = createClusterServices({ db, client, metrics, hosted, selfHostChannelIds: config.channelIds });
    const { settings, events, logWriter, nicknameSync, mute } = services;

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
    const sweepTimer = startIdleSweeps({ cluster, client, db, services, isReady: () => ready });
    serveGatewayRequests({ cluster, client, db, registry, services, hosted, isReady: () => ready });

    registerInteractionHandlers(
        client,
        createCommandContext(gateway, new LinkingService(db, events, hosted?.blocks), events, settings, hosted),
    );
    registerVoiceRejoin(client, mute);
    if (hosted) bindGuildLifecycle(client, hosted.lifecycle);
    client.once(Events.ClientReady, (readyClient) => {
        const markReady = () => {
            ready = true;
        };
        onReady({ client: readyClient, cluster, services, lifecycle: hosted?.lifecycle, markReady }).catch(
            (error: unknown) =>
                logger.error(logModules.Bot, `Cluster ${cluster.clusterID} failed to finish starting`, error),
        );
    });

    const stop = createStop({ cluster, client, db, logWriter, sweepTimer });
    const stopAndExit = (exitCode: number): void => {
        void stop().finally(() => process.exit(exitCode));
    };
    cluster.onSelfDestruct = stop;
    // Without the IPC channel the gateway is gone; staying alive would leave an orphaned bot connected.
    process.once("disconnect", () => {
        logger.warn(logModules.Bot, `Cluster ${cluster.clusterID} lost the gateway, exiting`);
        stopAndExit(0);
    });

    await logInOrExit(client, cluster, stopAndExit);
}
