import { z } from "zod";
import { type SnapshotInstance, withTimeout } from "../Metrics/MetricsCollector";
import type { ClusterInfo } from "./Contract";

export const CLUSTER_INFO_KIND = "cluster-info";

const DEFAULT_TIMEOUT_MS = 3000;

const requestSchema = z.strictObject({ kind: z.literal(CLUSTER_INFO_KIND) });

const replySchema = z.object({
    ok: z.literal(true),
    id: z.number().int(),
    guilds: z.number().int(),
    wsPingMs: z.number(),
});

export type ClusterInfoReply = z.infer<typeof replySchema>;

export function isClusterInfoRequest(data: unknown): boolean {
    return requestSchema.safeParse(data).success;
}

function unreachable(id: number): ClusterInfo {
    return { id, ok: false, guilds: null, wsPingMs: null };
}

/** Asks every cluster for its guild count and ping; a cluster that fails or stays silent is reported as not ok. */
export async function collectClusterInfo<TCluster>(
    instance: SnapshotInstance<TCluster>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ClusterInfo[]> {
    const request = { kind: CLUSTER_INFO_KIND };
    const asked = [...instance.clusters.entries()].map(async ([id, cluster]): Promise<ClusterInfo> => {
        try {
            const reply = await withTimeout(instance.sendRequestToCluster(cluster, request, timeoutMs), timeoutMs);
            const parsed = replySchema.safeParse(reply);
            if (!parsed.success) return unreachable(id);
            return { id, ok: true, guilds: parsed.data.guilds, wsPingMs: parsed.data.wsPingMs };
        } catch {
            return unreachable(id);
        }
    });
    return (await Promise.all(asked)).sort((a, b) => a.id - b.id);
}
