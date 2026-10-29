import { describe, expect, it, vi } from "vitest";
import { CLUSTER_INFO_KIND, collectClusterInfo, isClusterInfoRequest } from "../../src/Admin/ClusterInfo";

function fakeInstance(replies: (cluster: { id: number }) => Promise<unknown>) {
    const clusters = new Map([
        [0, { id: 0 }],
        [1, { id: 1 }],
    ]);
    return { clusters, sendRequestToCluster: vi.fn((cluster: { id: number }) => replies(cluster)) };
}

const okReply = (id: number) => ({ ok: true, id, guilds: 3 + id, wsPingMs: 40 + id });

describe("cluster info", () => {
    it("recognises only its own request", () => {
        expect(isClusterInfoRequest({ kind: CLUSTER_INFO_KIND })).toBe(true);
        expect(isClusterInfoRequest({ kind: "metrics-snapshot" })).toBe(false);
        expect(isClusterInfoRequest({ kind: CLUSTER_INFO_KIND, extra: 1 })).toBe(false);
        expect(isClusterInfoRequest(null)).toBe(false);
    });

    it("collects the answer of every cluster", async () => {
        const instance = fakeInstance(async (cluster) => okReply(cluster.id));

        const info = await collectClusterInfo(instance, 50);

        expect(info).toEqual([
            { id: 0, ok: true, guilds: 3, wsPingMs: 40 },
            { id: 1, ok: true, guilds: 4, wsPingMs: 41 },
        ]);
        expect(instance.sendRequestToCluster).toHaveBeenCalledWith({ id: 0 }, { kind: CLUSTER_INFO_KIND }, 50);
    });

    it("a hung cluster is reported as not ok within the timeout", async () => {
        const instance = fakeInstance((cluster) =>
            cluster.id === 0
                ? Promise.resolve(okReply(0))
                : new Promise(() => {
                      /* never answers */
                  }),
        );
        const started = Date.now();

        const info = await collectClusterInfo(instance, 50);

        expect(Date.now() - started).toBeLessThan(1000);
        expect(info).toEqual([
            { id: 0, ok: true, guilds: 3, wsPingMs: 40 },
            { id: 1, ok: false, guilds: null, wsPingMs: null },
        ]);
    });

    it("a failing or malformed answer is reported as not ok", async () => {
        const instance = fakeInstance(async (cluster) => {
            if (cluster.id === 0) throw new Error("boom");
            return { nonsense: true };
        });

        const info = await collectClusterInfo(instance, 50);

        expect(info).toEqual([
            { id: 0, ok: false, guilds: null, wsPingMs: null },
            { id: 1, ok: false, guilds: null, wsPingMs: null },
        ]);
    });
});
