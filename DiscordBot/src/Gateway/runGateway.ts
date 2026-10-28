import type { Server } from "node:http";
import { type ClusterProcess, StandaloneInstance } from "galactic.ts";
import { DISCORD_INTENTS } from "../Cluster/createDiscordClient";
import { config, DISCORD_TOKEN } from "../config";
import { databaseOptionsFrom, openDatabase } from "../Data/database";
import { logger, logModules } from "../Logging/logger";
import { clusterSpawnOptions } from "../Process/processRole";
import { GalacticClusterRouter } from "../Routing/ClusterRouter";
import { LinkingService } from "../Utils/LinkingService";
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

/** The gateway owns the plugin connections and the database migrations; Discord itself runs in the clusters. */
export async function runGateway(): Promise<void> {
    const db = await openDatabase(databaseOptionsFrom(config));
    logger.success(logModules.Database, "Database is ready!");

    const instance = createInstance();
    const pluginGateway = new PluginGateway({
        resolver: new SelfHostSecretResolver(config),
        router: new GalacticClusterRouter(instance),
        linking: new LinkingService(db),
    });
    const server = createGatewayHttpServer();
    pluginGateway.attach(server);

    const handleRequest = createGatewayRequestHandler(pluginGateway);
    instance.on("request", (_cluster, data, resolve) => resolve(handleRequest(data)));

    let stopping = false;
    const shutdown = async (exitCode: number): Promise<void> => {
        if (stopping) return;
        stopping = true;
        setTimeout(() => process.exit(exitCode), SHUTDOWN_TIMEOUT_MS).unref();
        await shutdownGateway({
            stopRespawning: () => instance.stopRespawning(),
            closePluginSessions: () => pluginGateway.close(),
            stopClusters: () => instance.shutdown(),
            closeHttpServer: () => closeServer(server),
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
    instance.start();
}
