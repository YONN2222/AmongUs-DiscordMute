import type { Server } from "node:http";
import { type ClusterProcess, StandaloneInstance } from "galactic.ts";
import { Registry } from "prom-client";
import { DISCORD_INTENTS } from "../Cluster/createDiscordClient";
import { config, DISCORD_TOKEN } from "../config";
import { databaseOptionsFrom, openDatabase } from "../Data/database";
import { configureLogger, logger, logModules } from "../Logging/logger";
import { createGatewayMetrics, createGatewayMetricsObserver } from "../Metrics/gatewayMetrics";
import { GalacticSnapshotSource, MetricsCollector } from "../Metrics/MetricsCollector";
import { createMetricsServer } from "../Metrics/metricsServer";
import { clusterSpawnOptions, isCompiledExecutable } from "../Process/processRole";
import { GalacticClusterRouter } from "../Routing/ClusterRouter";
import { readInstanceId } from "../Telemetry/readInstanceId";
import { TelemetryBuilder } from "../Telemetry/TelemetryBuilder";
import { TelemetryService, telemetryTarget } from "../Telemetry/TelemetryService";
import { startUpdateChecks } from "../Updates/UpdateChecker";
import { LinkingService } from "../Utils/LinkingService";
import { BOT_VERSION } from "../version";
import { createGatewayRequestHandler } from "./gatewayRequestHandler";
import { createGatewayHttpServer } from "./httpServer";
import { PluginGateway } from "./PluginGateway";
import { SelfHostSecretResolver } from "./SecretResolver";
import { createClusterExitHandler, onShutdownSignal, shutdownGateway } from "./shutdown";

const SHUTDOWN_TIMEOUT_MS = 20000;

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

function createInstance(): StandaloneInstance {
    return new StandaloneInstance(
        Bun.main,
        config.clusters.shardsPerCluster,
        config.clusters.total,
        DISCORD_TOKEN,
        [...DISCORD_INTENTS],
        [],
        clusterSpawnOptions(Bun.main, process.execPath),
    );
}

function logClusterEvents(
    instance: StandaloneInstance,
    onClusterExit: (id: number, code: number | null) => void,
): void {
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
    db: Awaited<ReturnType<typeof openDatabase>>,
    collector: MetricsCollector,
): Promise<TelemetryService | undefined> {
    const target = telemetryTarget({
        disabled: config.disableTelemetry,
        compiled: isCompiledExecutable(Bun.main, process.execPath),
        mode: "self-host",
        env: process.env,
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
                `Telemetry is off because the instance id could not be read: ${error instanceof Error ? error.message : String(error)}`,
            ),
    );
    if (!instanceId) return undefined;
    const builder = new TelemetryBuilder({
        instanceId,
        mode: "self-host",
        botVersion: BOT_VERSION,
        countLinkedUsers: () => db.telemetry.countLinkedUsers(),
    });
    logger.info(logModules.Telemetry, "Anonymous telemetry is on (see README to turn it off)");
    return new TelemetryService({ target, fetch, collect: () => collector.snapshots(), builder });
}

/** The gateway owns the plugin connections and the database migrations; Discord itself runs in the clusters. */
export async function runGateway(): Promise<void> {
    configureLogger({ format: config.logFormat, processName: "gateway" });
    const db = await openDatabase(databaseOptionsFrom(config));
    logger.success(logModules.Database, "Database is ready!");

    const instance = createInstance();
    const gatewayRegistry = new Registry();
    const gatewayMetrics = createGatewayMetrics(gatewayRegistry);
    const collector = new MetricsCollector({
        gatewayRegistry,
        clusters: new GalacticSnapshotSource(instance, () => gatewayMetrics.clusterSnapshotFailures.inc()),
    });
    const pluginGateway = new PluginGateway({
        resolver: new SelfHostSecretResolver(config),
        router: new GalacticClusterRouter(instance),
        linking: new LinkingService(db),
        observer: createGatewayMetricsObserver(gatewayMetrics),
    });
    const metricsServer = config.metrics.enabled
        ? createMetricsServer({ collector, token: config.metrics.token })
        : undefined;
    const telemetry = await createTelemetryService(db, collector);
    const updateChecks = config.disableUpdateCheck
        ? undefined
        : startUpdateChecks({
              currentVersion: BOT_VERSION,
              fetch,
              notify: ({ version, url }) =>
                  logger.warn(
                      logModules.Updates,
                      `DiscordMute ${version} is available (running ${BOT_VERSION}): ${url}`,
                  ),
          });
    const server = createGatewayHttpServer();
    pluginGateway.attach(server);

    const handleRequest = createGatewayRequestHandler(pluginGateway);
    instance.on("request", (_cluster, data, resolve) => resolve(handleRequest(data)));

    let stopping = false;
    const shutdown = async (exitCode: number): Promise<void> => {
        if (stopping) return;
        stopping = true;
        telemetry?.stop();
        updateChecks?.stop();
        setTimeout(() => process.exit(exitCode), SHUTDOWN_TIMEOUT_MS).unref();
        await shutdownGateway({
            stopRespawning: () => instance.stopRespawning(),
            closePluginSessions: () => pluginGateway.close(),
            stopClusters: () => instance.shutdown(),
            closeHttpServer: async () => {
                await Promise.all([closeServer(server), metricsServer ? closeServer(metricsServer) : undefined]);
            },
            closeDatabase: () => db.close(),
        });
        process.exit(exitCode);
    };

    onShutdownSignal((signal) => {
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

    await listen(server, config.botPort, config.botIp);
    logger.success(logModules.WebServer, `Gateway listening on ${config.botIp}:${config.botPort}`);
    if (metricsServer) {
        await listen(metricsServer, config.metrics.port, config.metrics.host);
        logger.success(
            logModules.Metrics,
            `Metrics endpoint listening on ${config.metrics.host}:${config.metrics.port}`,
        );
    }
    instance.start();
    telemetry?.start();
}
