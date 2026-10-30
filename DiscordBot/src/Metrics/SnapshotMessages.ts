import { z } from "zod";

export const METRICS_SNAPSHOT_KIND = "metrics-snapshot";

export type MetricsSnapshotReply = { ok: true; source: string; metrics: unknown[] } | { ok: false; error: string };

const MAX_SOURCE_LENGTH = 32;
const MAX_METRICS = 200;

const requestSchema = z.strictObject({ kind: z.literal(METRICS_SNAPSHOT_KIND) });

const replySchema = z.union([
    z.object({
        ok: z.literal(true),
        source: z.string().max(MAX_SOURCE_LENGTH),
        metrics: z
            .array(z.looseObject({ name: z.string(), type: z.string(), values: z.array(z.unknown()) }))
            .max(MAX_METRICS),
    }),
    z.object({ ok: z.literal(false), error: z.string() }),
]);

export function isMetricsSnapshotRequest(data: unknown): boolean {
    return requestSchema.safeParse(data).success;
}

export function parseMetricsSnapshotReply(value: unknown): MetricsSnapshotReply {
    const result = replySchema.safeParse(value);
    return result.success ? result.data : { ok: false, error: "invalid snapshot" };
}
