import type { Server } from "node:http";
import { createAdminHandlers } from "../Admin/AdminHandlers";
import { createAdminServer } from "../Admin/AdminServer";
import { collectClusterInfo } from "../Admin/ClusterInfo";
import type { Database } from "../Data/Database";
import { AUDIT_RETENTION_MS, type AuditLogRepository } from "../Data/Repositories/AuditLogRepository";
import { BlockChecker } from "../Hosted/BlockChecker";
import { assertHostedDatabase, readAdminApiToken } from "../Hosted/HostedMode";
import { HostedSecretResolver } from "../Hosted/HostedSecretResolver";
import type { Config } from "../Infrastructure/ConfigSchema";
import { logger, logModules } from "../Logging/Logger";
import type { GatewayMetrics } from "../Metrics/GatewayMetrics";
import type { SnapshotInstance } from "../Metrics/MetricsCollector";
import { GalacticClusterRouter, type GalacticInstanceLike } from "../Routing/ClusterRouter";
import { BOT_VERSION } from "../Version";
import type { PluginGateway } from "./PluginGateway";
import type { SecretResolver } from "./SecretResolver";

const AUDIT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Checks what hosted mode needs before anything starts; returns the admin API token or throws a message for the operator. */
export function readHostedAdminTokenOrThrow(config: Config, env: Record<string, string | undefined>): string {
    const token = readAdminApiToken(env);
    assertHostedDatabase(config);
    return token;
}

export interface HostedGatewayDeps<TCluster> {
    token: string;
    db: Database;
    metrics: Pick<GatewayMetrics, "activeGames">;
    instance: SnapshotInstance<TCluster> & GalacticInstanceLike;
}

/** What the gateway adds in hosted mode; none of it exists in self-host. */
export interface HostedGateway {
    blocks: BlockChecker;
    resolver: SecretResolver;
    /** The admin API needs the plugin gateway, which in turn needs the resolver above, so it is built second. */
    createAdminServer(plugins: PluginGateway): Server;
}

export function createHostedGateway<TCluster>(deps: HostedGatewayDeps<TCluster>): HostedGateway {
    const { db } = deps;
    const blocks = new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds });
    return {
        blocks,
        resolver: new HostedSecretResolver({ secrets: db.guildSecrets, blocks }),
        createAdminServer: (plugins) => {
            const handlers = createAdminHandlers({
                db,
                plugins,
                activeGames: async () => (await deps.metrics.activeGames.get()).values[0]?.value ?? 0,
                clusterInfo: () => collectClusterInfo(deps.instance),
                router: new GalacticClusterRouter(deps.instance),
                version: BOT_VERSION,
                startedAt: Date.now(),
            });
            return createAdminServer({ token: deps.token, handlers });
        },
    };
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
