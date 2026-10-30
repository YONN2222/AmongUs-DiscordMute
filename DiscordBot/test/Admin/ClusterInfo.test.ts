import { describe, expect, it, vi } from "vitest";
import { CLUSTER_INFO_KIND, collectClusterInfo, isClusterInfoRequest } from "../../src/Admin/ClusterInfo";
import { ClusterInfoSchema } from "../../src/Admin/Contract";

interface FakeCluster {
    id: number;
    shardList: number[];
    status: "starting" | "running" | "stopped";
    createdAt: number;
}

function fakeInstance(replies: (cluster: FakeCluster) => Promise<unknown>) {
    const clusters = new Map<number, FakeCluster>([
        [0, { id: 0, shardList: [0, 1], status: "running", createdAt: 1000 }],
        [1, { id: 1, shardList: [2, 3], status: "starting", createdAt: 2000 }],
    ]);
    return { clusters, sendRequestToCluster: vi.fn((cluster: FakeCluster) => replies(cluster)) };
}

const TIMEOUT_MS = 3000;

const shard = (id: number) => ({ id, status: 0, pingMs: 40, guilds: 1, lastPingAt: 5000 });

const okReply = (id: number) => ({
    ok: true,
    id,
    guilds: 3 + id,
    wsPingMs: 40 + id,
    uptimeSeconds: 60,
    memoryRssBytes: 1024,
    shards: [shard(2 * id), shard(2 * id + 1)],
});

const answered = (id: number, status: string, createdAt: number) => ({
    id,
    ok: true,
    status,
    shardIds: [2 * id, 2 * id + 1],
    startedAt: createdAt,
    guilds: 3 + id,
    wsPingMs: 40 + id,
    uptimeSeconds: 60,
    memoryRssBytes: 1024,
    shards: [shard(2 * id), shard(2 * id + 1)],
});

const silent = (id: number, status: string, createdAt: number) => ({
    id,
    ok: false,
    status,
    shardIds: [2 * id, 2 * id + 1],
    startedAt: createdAt,
    guilds: null,
    wsPingMs: null,
    uptimeSeconds: null,
    memoryRssBytes: null,
    shards: [],
});

describe("cluster info", () => {
    it("recognises only its own request", () => {
        expect(isClusterInfoRequest({ kind: CLUSTER_INFO_KIND })).toBe(true);
        expect(isClusterInfoRequest({ kind: "metrics-snapshot" })).toBe(false);
        expect(isClusterInfoRequest({ kind: CLUSTER_INFO_KIND, extra: 1 })).toBe(false);
        expect(isClusterInfoRequest(null)).toBe(false);
    });

    it("merges the answer of every cluster with what the gateway knows about it", async () => {
        const instance = fakeInstance(async (cluster) => okReply(cluster.id));

        const info = await collectClusterInfo(instance, { timeoutMs: TIMEOUT_MS });

        expect(info).toEqual([answered(0, "running", 1000), answered(1, "starting", 2000)]);
        for (const entry of info) expect(ClusterInfoSchema.safeParse(entry).success).toBe(true);
        expect(instance.sendRequestToCluster).toHaveBeenCalledWith(
            expect.objectContaining({ id: 0 }),
            { kind: CLUSTER_INFO_KIND },
            TIMEOUT_MS,
        );
    });

    it("a hung cluster is reported as not ok within the timeout and keeps its shard ids", async () => {
        const instance = fakeInstance((cluster) =>
            cluster.id === 0
                ? Promise.resolve(okReply(0))
                : new Promise(() => {
                      /* never answers */
                  }),
        );
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            const collecting = collectClusterInfo(instance, { timeoutMs: TIMEOUT_MS });
            await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

            expect(await collecting).toEqual([answered(0, "running", 1000), silent(1, "starting", 2000)]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a failing or malformed answer is reported as not ok", async () => {
        const instance = fakeInstance(async (cluster) => {
            if (cluster.id === 0) throw new Error("boom");
            return { ...okReply(1), shards: [{ id: "x" }] };
        });

        const info = await collectClusterInfo(instance, { timeoutMs: TIMEOUT_MS });

        expect(info).toEqual([silent(0, "running", 1000), silent(1, "starting", 2000)]);
        for (const entry of info) expect(ClusterInfoSchema.safeParse(entry).success).toBe(true);
    });

    it("asks only the requested cluster, so a hung sibling does not slow it down", async () => {
        const instance = fakeInstance((cluster) =>
            cluster.id === 1
                ? Promise.resolve(okReply(1))
                : new Promise(() => {
                      /* never answers */
                  }),
        );

        expect(await collectClusterInfo(instance, { clusterId: 1 })).toEqual([answered(1, "starting", 2000)]);
        expect(instance.sendRequestToCluster).toHaveBeenCalledTimes(1);
        expect(await collectClusterInfo(instance, { clusterId: 7 })).toEqual([]);
    });

    it("a stopped cluster that cannot answer still lists its shards", async () => {
        const instance = fakeInstance(async () => {
            throw new Error("channel closed");
        });
        instance.clusters.set(1, { id: 1, shardList: [2, 3], status: "stopped", createdAt: 2000 });

        const info = await collectClusterInfo(instance, { timeoutMs: TIMEOUT_MS });

        expect(info[1]).toEqual(silent(1, "stopped", 2000));
    });
});
