import { logger, logModules } from "../Logging/logger";
import { CLUSTER_EXIT_LOGIN_FAILED } from "../Process/processRole";

export interface GatewayShutdownSteps {
    /** Routes session-ended for every open plugin session, so the clusters lift the mutes. */
    closePluginSessions: () => Promise<void>;
    stopClusters: () => Promise<void>;
    closeHttpServer: () => Promise<void>;
    closeDatabase: () => Promise<void>;
}

/** Runs the steps strictly in order; a failing step is logged and does not skip the ones after it. */
export async function shutdownGateway(steps: GatewayShutdownSteps): Promise<void> {
    const ordered: [string, () => Promise<void>][] = [
        ["close plugin sessions", steps.closePluginSessions],
        ["stop clusters", steps.stopClusters],
        ["close the HTTP server", steps.closeHttpServer],
        ["close the database", steps.closeDatabase],
    ];
    for (const [name, step] of ordered) {
        try {
            await step();
        } catch (error) {
            logger.error(logModules.Bot, `Shutdown: could not ${name}`, error);
        }
    }
}

export interface ClusterExitDeps {
    stopRespawning: () => void;
    shutdown: (exitCode: number) => void;
}

/** galactic restarts a cluster that exits; only an invalid token makes the whole bot stop instead. */
export function createClusterExitHandler(deps: ClusterExitDeps): (clusterId: number, code: number | null) => void {
    return (clusterId, code) => {
        if (code === CLUSTER_EXIT_LOGIN_FAILED) {
            logger.error(
                logModules.Bot,
                `Cluster ${clusterId}: Discord rejected the token, check config.json. Shutting down.`,
            );
            deps.stopRespawning();
            deps.shutdown(1);
            return;
        }
        if (code !== 0) logger.warn(logModules.Bot, `Cluster ${clusterId} exited with code ${code}, restarting it`);
    };
}
