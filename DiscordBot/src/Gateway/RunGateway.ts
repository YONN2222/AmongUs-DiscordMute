import type { Server } from "node:http";
import { type ClusterProcess, StandaloneInstance } from "galactic.ts";
import { Registry } from "prom-client";
import { DISCORD_INTENTS } from "../Cluster/CreateDiscordClient";
import type { Config } from "../Config/ConfigSchema";
import { legacyConfigWarnings } from "../Config/LegacyConfigWarnings";
import { type Database, databaseOptionsFrom, openDatabase } from "../Data/Database";
import { isHosted } from "../Hosted/HostedMode";
import { LinkingService } from "../Linking/LinkingService";
import { configureLogger, logger, logModules, resolveLogLevel } from "../Logging/Logger";
import { createGatewayMetrics, createGatewayMetricsObserver, type GatewayMetrics } from "../Metrics/GatewayMetrics";
import { GalacticSnapshotSource, MetricsCollector } from "../Metrics/MetricsCollector";
import { createMetricsServer } from "../Metrics/MetricsServer";
import { EXIT_CONFIG } from "../Process/ExitCodes";
import { clusterSpawnOptions, isCompiledExecutable } from "../Process/ProcessRole";
import { GalacticClusterRouter } from "../Routing/ClusterRouter";
import { readInstanceId } from "../Telemetry/ReadInstanceId";
import { TelemetryBuilder } from "../Telemetry/TelemetryBuilder";
import { TelemetryService, telemetryTarget } from "../Telemetry/TelemetryService";
import { startUpdateChecks } from "../Updates/UpdateChecker";
import { errorMessage } from "../Utils/ErrorMessage";
import { BOT_VERSION } from "../Version";
import { createGatewayRequestHandler } from "./GatewayRequestHandler";
import { GuildSecretResolver } from "./GuildSecretResolver";
import { createHostedGateway, readHostedAdminTokenOrThrow, startHourlyCleanup } from "./HostedGateway";
import { createGatewayHttpServer } from "./HttpServer";
import { PluginGateway } from "./PluginGateway";
import { ChainedSecretResolver, type SecretResolver, SelfHostSecretResolver } from "./SecretResolver";
import { createClusterExitHandler, onShutdownSignal, shutdownGateway } from "./Shutdown";

/**
 * Closing the plugin sessions alone can take about 20 s (queued messages drained, session ends routed); the
 * clusters and the database still need time after that, so the forced exit comes well later.
 */
const SHUTDOWN_TIMEOUT_MS = 45_000;

/** The parts of the galactic instance the gateway uses, so a test can start the gateway without clusters. */
export type GatewayInstance = Pick<
    StandaloneInstance,
    "on" | "start" | "stopRespawning" | "shutdown" | "clusters" | "sendRequestToCluster" | "sendRequestToClusterOfGuild"
>;

export interface GatewayDeps {
    env: Record<string, string | undefined>;
    exit: (code: number) => void;
    createInstance: (config: Config) => GatewayInstance;
    onShutdownSignal: (handler: (signal: NodeJS.Signals) => void) => void;
}

export interface RunningGateway {
    shutdown(exitCode: number): Promise<void>;
}

function listen(server: Server, port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
        });
    });
}

function closeServer(server: Server): Promise<void> {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
}

function createInstance(config: Config): GatewayInstance {
    return new StandaloneInstance(
        Bun.main,
        config.clusters.shardsPerCluster,
        config.clusters.total,
        config.token,
        [...DISCORD_INTENTS],
        [],
        clusterSpawnOptions(Bun.main, process.execPath),
    );
}

export const defaultGatewayDeps: GatewayDeps = {
    env: process.env,
    exit: (code) => process.exit(code),
    createInstance,
    onShutdownSignal,
};

function logClusterEvents(instance: GatewayInstance, onClusterExit: (id: number, code: number | null) => void): void {
    instance.on("PROCESS_SPAWNED", (cluster: ClusterProcess) => {
        logger.info(logModules.Bot, `Cluster ${cluster.id} started (shards ${cluster.shardList.join(", ")})`);
        cluster.child.once("exit", (code) => onClusterExit(cluster.id, code));
    });
    instance.on("CLUSTER_READY", (cluster) => logger.success(logModules.Bot, `Cluster ${cluster.id} is ready`));
    instance.on("PROCESS_KILLED", (cluster, reason) =>
        logger.warn(logModules.Bot, `Cluster ${cluster.id} stopped: ${reason}`),
    );
    instance.on("PROCESS_ERROR", (cluster, error) =>
        logger.error(logModules.Bot, `Cluster ${cluster.id} process error`, error),
    );
    instance.on("CLUSTER_ERROR", (cluster, error) =>
        logger.error(logModules.Bot, `Cluster ${cluster.id} failed`, error),
    );
    // galactic reports this when it kills a cluster that had already exited on its own.
    instance.on("ERROR", (error) => logger.debug(logModules.Bot, error));
}

async function createTelemetryService(
    config: Config,
    env: GatewayDeps["env"],
    db: Database,
    collector: MetricsCollector,
): Promise<TelemetryService | undefined> {
    const target = telemetryTarget({
        disabled: config.disableTelemetry,
        compiled: isCompiledExecutable(Bun.main, process.execPath),
        mode: config.mode,
        env,
    });
    if (!target) {
        if (config.disableTelemetry)
            logger.debug(logModules.Telemetry, "Anonymous telemetry is disabled in the config");
        return undefined;
    }
    const instanceId = await readInstanceId(
        () => db.telemetry.getOrCreateInstanceId(),
        (error) =>
            logger.warn(
                logModules.Telemetry,
                `Telemetry is off because the instance id could not be read: ${errorMessage(error)}`,
            ),
    );
    if (!instanceId) return undefined;
    const builder = new TelemetryBuilder({
        instanceId,
        mode: config.mode,
        botVersion: BOT_VERSION,
        countLinkedUsers: () => db.telemetry.countLinkedUsers(),
    });
    logger.info(logModules.Telemetry, "Anonymous telemetry is on (see README to turn it off)");
    return new TelemetryService({ target, fetch, collect: () => collector.snapshots(), builder });
}

/**
 * Secrets created with /setup, plus the deprecated config.json secret so existing installs keep working.
 * The config.json secret stops working for a server as soon as that server creates a secret in /setup.
 */
export function selfHostResolver(
    cfg: Pick<Config, "guildId" | "secret">,
    db: Pick<Database, "guildSecrets">,
): SecretResolver {
    const resolvers: SecretResolver[] = [new GuildSecretResolver(db.guildSecrets)];
    if (cfg.guildId !== undefined && cfg.secret !== undefined) {
        const hasStoredSecret = async (guildId: string) => (await db.guildSecrets.get(guildId)) !== null;
        resolvers.push(new SelfHostSecretResolver({ guildId: cfg.guildId, secret: cfg.secret }, hasStoredSecret));
    }
    return new ChainedSecretResolver(resolvers);
}

type StartupMode = { hosted: false } | { hosted: true; adminToken: string };

/**
 * Decides hosted or self-host once, before anything opens. Throws a message for the operator when hosted mode
 * cannot start.
 */
function readStartupMode(config: Config, env: GatewayDeps["env"]): StartupMode {
    if (!isHosted(config)) return { hosted: false };
    return { hosted: true, adminToken: readHostedAdminTokenOrThrow(config, env) };
}

function startUpdateChecksUnlessDisabled(config: Config): { stop(): void } | undefined {
    if (config.disableUpdateCheck) return undefined;
    return startUpdateChecks({
        currentVersion: BOT_VERSION,
        fetch,
        notify: ({ version, url }) =>
            logger.warn(logModules.Updates, `DiscordMute ${version} is available (running ${BOT_VERSION}): ${url}`),
    });
}

interface ShutdownParts {
    exit: GatewayDeps["exit"];
    /** Timers and loops that must not fire while the rest shuts down. */
    stopBackgroundTasks: () => void;
    instance: GatewayInstance;
    pluginGateway: PluginGateway;
    servers: (Server | undefined)[];
    db: Database;
}

/** Builds the gateway's shutdown: runs once, in order, and exits even if a step hangs. */
function createShutdown(parts: ShutdownParts): (exitCode: number) => Promise<void> {
    let stopping = false;
    return async (exitCode) => {
        if (stopping) return;
        stopping = true;
        parts.stopBackgroundTasks();
        const forcedExit = setTimeout(() => parts.exit(exitCode), SHUTDOWN_TIMEOUT_MS);
        forcedExit.unref();
        await shutdownGateway({
            stopRespawning: () => parts.instance.stopRespawning(),
            closePluginSessions: () => parts.pluginGateway.close(),
            stopClusters: () => parts.instance.shutdown(),
            closeHttpServer: async () => {
                const open = parts.servers.filter((s): s is Server => s !== undefined);
                await Promise.all(open.map(closeServer));
            },
            closeDatabase: () => parts.db.close(),
        });
        clearTimeout(forcedExit);
        parts.exit(exitCode);
    };
}

function createMetrics(instance: GatewayInstance): { gatewayMetrics: GatewayMetrics; collector: MetricsCollector } {
    const gatewayRegistry = new Registry();
    const gatewayMetrics = createGatewayMetrics(gatewayRegistry);
    const collector = new MetricsCollector({
        gatewayRegistry,
        clusters: new GalacticSnapshotSource(instance, () => gatewayMetrics.clusterSnapshotFailures.inc()),
    });
    return { gatewayMetrics, collector };
}

function shutDownOnSignalOrFatalClusterExit(
    instance: GatewayInstance,
    deps: GatewayDeps,
    shutdown: (exitCode: number) => Promise<void>,
): void {
    deps.onShutdownSignal((signal) => {
        logger.warn(logModules.Bot, `${signal} received, shutting down...`);
        void shutdown(0);
    });

    logClusterEvents(
        instance,
        createClusterExitHandler({
            stopRespawning: () => instance.stopRespawning(),
            shutdown: (exitCode) => void shutdown(exitCode),
        }),
    );
}

async function startListening(
    server: Server,
    metricsServer: Server | undefined,
    adminServer: Server | undefined,
    config: Config,
): Promise<void> {
    await listen(server, config.botPort, config.botIp);
    logger.success(logModules.WebServer, `Gateway listening on ${config.botIp}:${config.botPort}`);
    if (metricsServer) {
        await listen(metricsServer, config.metrics.port, config.metrics.host);
        logger.success(
            logModules.Metrics,
            `Metrics endpoint listening on ${config.metrics.host}:${config.metrics.port}`,
        );
    }
    if (adminServer) {
        await listen(adminServer, config.adminApi.port, config.adminApi.host);
        logger.success(logModules.WebServer, `Admin API listening on ${config.adminApi.host}:${config.adminApi.port}`);
    }
}

/**
 * The gateway owns the plugin connections and the database migrations; Discord itself runs in the clusters.
 * Resolves to undefined when the configuration cannot start, after `deps.exit` was called.
 */
export async function runGateway(
    config: Config,
    deps: GatewayDeps = defaultGatewayDeps,
): Promise<RunningGateway | undefined> {
    configureLogger({ format: config.logFormat, processName: "gateway", level: resolveLogLevel(config.logLevel) });
    logger.success(logModules.Bot, `DiscordMute ${BOT_VERSION} starting (${config.mode})`);
    let mode: StartupMode;
    try {
        mode = readStartupMode(config, deps.env);
    } catch (error) {
        logger.error(logModules.Bot, errorMessage(error));
        deps.exit(EXIT_CONFIG);
        return undefined;
    }

    for (const warning of legacyConfigWarnings(config)) logger.warn(logModules.Bot, warning);

    const db = await openDatabase(databaseOptionsFrom(config));
    logger.success(logModules.Database, `Database ready (${config.databaseDialect})`);

    const instance = deps.createInstance(config);
    const { gatewayMetrics, collector } = createMetrics(instance);
    const hosted = mode.hosted
        ? createHostedGateway({
              token: mode.adminToken,
              botToken: config.token,
              db,
              metrics: gatewayMetrics,
              instance,
          })
        : undefined;
    const pluginGateway = new PluginGateway({
        resolver: hosted?.resolver ?? selfHostResolver(config, db),
        router: new GalacticClusterRouter(instance),
        linking: new LinkingService(db, undefined, hosted?.blocks),
        observer: createGatewayMetricsObserver(gatewayMetrics),
        acceptPluginLogs: !mode.hosted,
    });
    const metricsServer = config.metrics.enabled
        ? createMetricsServer({ collector, token: config.metrics.token })
        : undefined;
    const adminServer = hosted?.createAdminServer(pluginGateway);
    const telemetry = await createTelemetryService(config, deps.env, db, collector);
    const updateChecks = startUpdateChecksUnlessDisabled(config);
    const server = createGatewayHttpServer();
    pluginGateway.attach(server);

    const handleRequest = createGatewayRequestHandler(pluginGateway);
    instance.on("request", (_cluster, data, resolve) => resolve(handleRequest(data)));

    let stopHourlyCleanup: (() => void) | undefined;
    const shutdown = createShutdown({
        exit: deps.exit,
        stopBackgroundTasks: () => {
            telemetry?.stop();
            updateChecks?.stop();
            stopHourlyCleanup?.();
        },
        instance,
        pluginGateway,
        servers: [server, metricsServer, adminServer],
        db,
    });

    shutDownOnSignalOrFatalClusterExit(instance, deps, shutdown);

    await startListening(server, metricsServer, adminServer, config);
    if (hosted) stopHourlyCleanup = startHourlyCleanup(db);
    instance.start();
    telemetry?.start();
    return { shutdown };
}
