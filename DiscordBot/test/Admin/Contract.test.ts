import { describe, expect, it } from "vitest";
import {
    AuditListQuerySchema,
    BlockListQuerySchema,
    ClusterInfoSchema,
    ClusterParamsSchema,
    CreateAuditBodySchema,
    CreateBlockBodySchema,
    GuildListQuerySchema,
    MAX_PAGE_LIMIT,
    ShardInfoSchema,
    SnowflakeSchema,
} from "../../src/Admin/Contract";

const SNOWFLAKE = "123456789012345678";

describe("admin contract", () => {
    it("create block body accepts a valid body", () => {
        const body = { type: "user", targetId: SNOWFLAKE, reason: "spam", actorId: SNOWFLAKE };
        expect(CreateBlockBodySchema.parse(body)).toEqual(body);
    });

    it("create block body rejects unknown keys", () => {
        const result = CreateBlockBodySchema.safeParse({
            type: "user",
            targetId: SNOWFLAKE,
            reason: "spam",
            actorId: SNOWFLAKE,
            extra: true,
        });
        expect(result.success).toBe(false);
    });

    it("create block body rejects an empty or oversized reason", () => {
        const body = { type: "guild", targetId: SNOWFLAKE, actorId: SNOWFLAKE };
        expect(CreateBlockBodySchema.safeParse({ ...body, reason: "" }).success).toBe(false);
        expect(CreateBlockBodySchema.safeParse({ ...body, reason: "x".repeat(501) }).success).toBe(false);
        expect(CreateBlockBodySchema.safeParse({ ...body, reason: "x".repeat(500) }).success).toBe(true);
    });

    it("snowflake rejects letters and 16 digits", () => {
        expect(SnowflakeSchema.safeParse("12345678901234567a").success).toBe(false);
        expect(SnowflakeSchema.safeParse("1234567890123456").success).toBe(false);
        expect(SnowflakeSchema.safeParse("123456789012345678901").success).toBe(false);
        expect(SnowflakeSchema.safeParse("12345678901234567").success).toBe(true);
        expect(SnowflakeSchema.safeParse("12345678901234567890").success).toBe(true);
    });

    it("dashboard audit body rejects action block.create", () => {
        expect(CreateAuditBodySchema.safeParse({ actorId: SNOWFLAKE, action: "block.create" }).success).toBe(false);
        expect(CreateAuditBodySchema.safeParse({ actorId: SNOWFLAKE, action: "dashboard.login" }).success).toBe(true);
    });

    it("dashboard audit body limits details", () => {
        const base = { actorId: SNOWFLAKE, action: "dashboard.logout" };
        const manyKeys = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`key${index}`, index]));
        expect(CreateAuditBodySchema.safeParse({ ...base, details: manyKeys }).success).toBe(false);
        expect(CreateAuditBodySchema.safeParse({ ...base, details: { note: "x".repeat(201) } }).success).toBe(false);
        expect(CreateAuditBodySchema.safeParse({ ...base, details: { note: "x".repeat(200), ok: true } }).success).toBe(
            true,
        );
    });

    it("page query applies defaults and clamps the limit", () => {
        expect(GuildListQuerySchema.parse({})).toEqual({ page: 1, limit: 25 });
        expect(GuildListQuerySchema.parse({ page: "3", limit: "500" })).toEqual({ page: 3, limit: MAX_PAGE_LIMIT });
        expect(GuildListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
        expect(GuildListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    });

    it("cluster info stays valid for a cluster that did not answer", () => {
        const silent = {
            id: 2,
            ok: false,
            status: "starting",
            shardIds: [4, 5],
            startedAt: null,
            guilds: null,
            wsPingMs: null,
            uptimeSeconds: null,
            memoryRssBytes: null,
            shards: [],
        };
        expect(ClusterInfoSchema.safeParse(silent).success).toBe(true);
        expect(ClusterInfoSchema.safeParse({ ...silent, status: "crashed" }).success).toBe(false);
    });

    it("shard info allows a missing ping but needs whole numbers", () => {
        const shard = { id: 0, status: 0, pingMs: null, guilds: 12, lastPingAt: null };
        expect(ShardInfoSchema.safeParse(shard).success).toBe(true);
        expect(ShardInfoSchema.safeParse({ ...shard, guilds: 1.5 }).success).toBe(false);
    });

    it("cluster params coerce a whole number from 0", () => {
        expect(ClusterParamsSchema.parse({ clusterId: "3" })).toEqual({ clusterId: 3 });
        expect(ClusterParamsSchema.parse({ clusterId: "0" })).toEqual({ clusterId: 0 });
        expect(ClusterParamsSchema.safeParse({ clusterId: "-1" }).success).toBe(false);
        expect(ClusterParamsSchema.safeParse({ clusterId: "x" }).success).toBe(false);
    });

    it("list queries validate their filters", () => {
        expect(BlockListQuerySchema.safeParse({ type: "role" }).success).toBe(false);
        expect(BlockListQuerySchema.parse({ type: "guild", q: SNOWFLAKE }).type).toBe("guild");
        expect(AuditListQuerySchema.safeParse({ action: "nope" }).success).toBe(false);
        expect(AuditListQuerySchema.parse({ actorId: "system" }).actorId).toBe("system");
    });
});
