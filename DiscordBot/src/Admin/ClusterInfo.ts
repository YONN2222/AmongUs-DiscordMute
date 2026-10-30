import { z } from "zod";
import { type SnapshotInstance, withTimeout } from "../Metrics/MetricsCollector";
import { type ClusterInfo, type ClusterStatus, ShardInfoSchema } from "./Contract";

export const CLUSTER_INFO_KIND = "cluster-info";

const DEFAULT_TIMEOUT_MS = 3000;

const requestSchema = z.strictObject({ kind: z.literal(CLUSTER_INFO_KIND) });

const replySchema = z.object({
    ok: z.literal(true),
    id: z.number().int(),
    guilds: z.number().int(),
    wsPingMs: z.number(),
    uptimeSeconds: z.number(),
    memoryRssBytes: z.number(),
    shards: z.array(ShardInfoSchema),
});

export type ClusterInfoReply = z.infer<typeof replySchema>;

/** What the gateway itself knows about a cluster process, whether or not the cluster answers. */
export interface ClusterProcessState {
    shardList: number[];
    status: ClusterStatus;
    createdAt: number;
}

export function isClusterInfoRequest(data: unknown): boolean {
    return requestSchema.safeParse(data).success;
}

function unreachable(known: Pick<ClusterInfo, "id" | "status" | "shardIds" | "startedAt">): ClusterInfo {
    return { ...known, ok: false, guilds: null, wsPingMs: null, uptimeSeconds: null, memoryRssBytes: null, shards: [] };
}

/** Asks every cluster for its guilds, ping, shards and resources; a cluster that fails or stays silent is not ok. */
export async function collectClusterInfo<TCluster extends ClusterProcessState>(
    instance: SnapshotInstance<TCluster>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ClusterInfo[]> {
    const request = { kind: CLUSTER_INFO_KIND };
    const asked = [...instance.clusters.entries()].map(async ([id, cluster]): Promise<ClusterInfo> => {
        const known = { id, status: cluster.status, shardIds: [...cluster.shardList], startedAt: cluster.createdAt };
        try {
            const reply = await withTimeout(instance.sendRequestToCluster(cluster, request, timeoutMs), timeoutMs);
            const parsed = replySchema.safeParse(reply);
            if (!parsed.success) return unreachable(known);
            const { guilds, wsPingMs, uptimeSeconds, memoryRssBytes, shards } = parsed.data;
            return { ...known, ok: true, guilds, wsPingMs, uptimeSeconds, memoryRssBytes, shards };
        } catch {
            return unreachable(known);
        }
    });
    return (await Promise.all(asked)).sort((a, b) => a.id - b.id);
}
