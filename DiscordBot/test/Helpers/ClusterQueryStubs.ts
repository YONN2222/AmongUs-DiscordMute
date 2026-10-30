import type { ClusterRequestHandlerDeps } from "../../src/Cluster/ClusterRequestHandler";

/** Fixed answers to the cluster-wide queries, for tests that only send guild requests. */
export const clusterQueryStubs: Pick<ClusterRequestHandlerDeps, "clusterInfo" | "metricsSnapshot"> = {
    clusterInfo: () => ({ ok: true, id: 0, guilds: 0, wsPingMs: 0, uptimeSeconds: 0, memoryRssBytes: 0, shards: [] }),
    metricsSnapshot: async () => ({ ok: true, source: "cluster-0", metrics: [] }),
};
