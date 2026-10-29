import type { Server } from "node:http";
import { createAdminHandlers } from "../Admin/AdminHandlers";
import { createAdminServer } from "../Admin/AdminServer";
import { collectClusterInfo } from "../Admin/ClusterInfo";
import type { Database } from "../Data/Database";
import { AUDIT_RETENTION_MS, type AuditLogRepository } from "../Data/Repositories/AuditLogRepository";
import { logger, logModules } from "../Logging/Logger";
import type { GatewayMetrics } from "../Metrics/GatewayMetrics";
import type { SnapshotInstance } from "../Metrics/MetricsCollector";
import { GalacticClusterRouter, type GalacticInstanceLike } from "../Routing/ClusterRouter";
import { BOT_VERSION } from "../Version";
import type { PluginGateway } from "./PluginGateway";

const AUDIT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface AdminApiDeps<TCluster> {
    token: string;
    db: Database;
    plugins: PluginGateway;
    metrics: Pick<GatewayMetrics, "activeGames">;
    instance: SnapshotInstance<TCluster> & GalacticInstanceLike;
}

/** The internal admin API of the hosted bot; it is never created in self-host. */
export function createAdminApi<TCluster>(deps: AdminApiDeps<TCluster>): Server {
    const handlers = createAdminHandlers({
        db: deps.db,
        plugins: deps.plugins,
        activeGames: async () => (await deps.metrics.activeGames.get()).values[0]?.value ?? 0,
        clusterInfo: () => collectClusterInfo(deps.instance),
        router: new GalacticClusterRouter(deps.instance),
        version: BOT_VERSION,
        startedAt: Date.now(),
    });
    return createAdminServer({ token: deps.token, handlers });
}

/** Deletes audit entries past the retention now and then every hour; returns the function that stops it. */
export function startAuditPrune(
    audit: Pick<AuditLogRepository, "pruneOlderThan">,
    now: () => number = Date.now,
): () => void {
    const prune = (): void => {
        audit.pruneOlderThan(now() - AUDIT_RETENTION_MS).then(
            (removed) => {
                if (removed > 0) logger.info(logModules.Database, `Removed ${removed} expired audit log entries`);
            },
            (error: unknown) => logger.error(logModules.Database, "Pruning the audit log failed", error),
        );
    };
    prune();
    const timer = setInterval(prune, AUDIT_PRUNE_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
}
