import { AggregatorRegistry, type MetricObjectWithValues, type MetricValue, type Registry } from "prom-client";
import { METRICS_SNAPSHOT_KIND, parseMetricsSnapshotReply } from "./SnapshotMessages";

const DEFAULT_TIMEOUT_MS = 3000;

export type ProcessSnapshot = { source: string; metrics: MetricObjectWithValues<MetricValue<string>>[] };

export interface ClusterSnapshotSource {
    snapshots(timeoutMs: number): Promise<ProcessSnapshot[]>;
}

interface SnapshotInstance<TCluster> {
    clusters: Map<number, TCluster>;
    sendRequestToCluster(cluster: TCluster, message: unknown, timeout: number): Promise<unknown>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("snapshot timed out")), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class GalacticSnapshotSource<TCluster> implements ClusterSnapshotSource {
    constructor(
        private readonly instance: SnapshotInstance<TCluster>,
        private readonly onFailure: () => void,
    ) {}

    async snapshots(timeoutMs: number): Promise<ProcessSnapshot[]> {
        const request = { kind: METRICS_SNAPSHOT_KIND };
        const settled = await Promise.allSettled(
            [...this.instance.clusters.values()].map((cluster) =>
                withTimeout(this.instance.sendRequestToCluster(cluster, request, timeoutMs), timeoutMs),
            ),
        );
        const snapshots: ProcessSnapshot[] = [];
        for (const result of settled) {
            const reply = result.status === "fulfilled" ? parseMetricsSnapshotReply(result.value) : undefined;
            if (reply?.ok) {
                snapshots.push({ source: reply.source, metrics: reply.metrics as ProcessSnapshot["metrics"] });
            } else {
                this.onFailure();
            }
        }
        return snapshots;
    }
}

export class MetricsCollector {
    private readonly timeoutMs: number;

    constructor(
        private readonly deps: { gatewayRegistry: Registry; clusters: ClusterSnapshotSource; timeoutMs?: number },
    ) {
        this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async snapshots(): Promise<ProcessSnapshot[]> {
        const [gateway, clusters] = await Promise.all([
            this.deps.gatewayRegistry.getMetricsAsJSON(),
            this.deps.clusters.snapshots(this.timeoutMs),
        ]);
        return [{ source: "gateway", metrics: gateway as ProcessSnapshot["metrics"] }, ...clusters];
    }

    async aggregated(): Promise<Registry> {
        const snapshots = await this.snapshots();
        return AggregatorRegistry.aggregate(snapshots.map((snapshot) => snapshot.metrics));
    }
}
