import { describe, expect, it } from "vitest";
import {
    isMetricsSnapshotRequest,
    METRICS_SNAPSHOT_KIND,
    parseMetricsSnapshotReply,
} from "../../src/Metrics/snapshotMessages";

const metric = { name: "discordmute_guilds", type: "gauge", help: "Guilds", aggregator: "sum", values: [] };

describe("snapshotMessages", () => {
    it("recognises only the exact snapshot request", () => {
        expect(isMetricsSnapshotRequest({ kind: METRICS_SNAPSHOT_KIND })).toBe(true);
        expect(isMetricsSnapshotRequest({ kind: "metrics-snapshot", x: 1 })).toBe(false);
        expect(isMetricsSnapshotRequest("metrics-snapshot")).toBe(false);
        expect(isMetricsSnapshotRequest(null)).toBe(false);
        expect(isMetricsSnapshotRequest({ kind: "game-event" })).toBe(false);
    });

    it("accepts a valid reply and passes failures through", () => {
        expect(parseMetricsSnapshotReply({ ok: true, source: "cluster-0", metrics: [metric] })).toEqual({
            ok: true,
            source: "cluster-0",
            metrics: [metric],
        });
        expect(parseMetricsSnapshotReply({ ok: false, error: "boom" })).toEqual({ ok: false, error: "boom" });
    });

    it("rejects a reply with 201 metrics", () => {
        const metrics = Array.from({ length: 201 }, () => metric);
        expect(parseMetricsSnapshotReply({ ok: true, source: "cluster-0", metrics })).toEqual({
            ok: false,
            error: "invalid snapshot",
        });
    });

    it("rejects a reply without values arrays", () => {
        const { values: _values, ...withoutValues } = metric;
        expect(parseMetricsSnapshotReply({ ok: true, source: "cluster-0", metrics: [withoutValues] })).toEqual({
            ok: false,
            error: "invalid snapshot",
        });
        expect(parseMetricsSnapshotReply({ ok: true, source: "x".repeat(33), metrics: [] })).toEqual({
            ok: false,
            error: "invalid snapshot",
        });
        expect(parseMetricsSnapshotReply(undefined)).toEqual({ ok: false, error: "invalid snapshot" });
    });
});
