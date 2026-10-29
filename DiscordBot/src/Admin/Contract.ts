import { z } from "zod";

export const ADMIN_API_PREFIX = "/admin/v1";
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_BODY_BYTES = 16384;
export const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

const MAX_REASON_LENGTH = 500;
const MAX_SEARCH_LENGTH = 100;
const MAX_AUDIT_DETAIL_KEYS = 10;
const MAX_AUDIT_DETAIL_STRING_LENGTH = 200;
const SYSTEM_ACTOR = "system";

export const SnowflakeSchema = z.string().regex(SNOWFLAKE_PATTERN);
export type Snowflake = z.infer<typeof SnowflakeSchema>;

/** Automatic actions are recorded as "system". */
export const ActorIdSchema = z.union([SnowflakeSchema, z.literal(SYSTEM_ACTOR)]);
export type ActorId = z.infer<typeof ActorIdSchema>;

export const BlockTypeSchema = z.enum(["user", "guild"]);
export type BlockType = z.infer<typeof BlockTypeSchema>;

const ReasonSchema = z.string().min(1).max(MAX_REASON_LENGTH);

export const AUDIT_ACTIONS = [
    "block.create",
    "block.remove",
    "guild.leave",
    "guild.auto-leave",
    "guild.purge",
    "secret.create",
    "secret.regenerate",
    "dashboard.login",
    "dashboard.logout",
    "dashboard.login-denied",
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** The only actions the dashboard may write itself; the bot records all others. */
export const DASHBOARD_AUDIT_ACTIONS = ["dashboard.login", "dashboard.logout", "dashboard.login-denied"] as const;
export const DashboardAuditActionSchema = z.enum(DASHBOARD_AUDIT_ACTIONS);
export type DashboardAuditAction = z.infer<typeof DashboardAuditActionSchema>;

const AuditDetailValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const AuditDetailsSchema = z.record(z.string(), AuditDetailValueSchema);
export type AuditDetails = z.infer<typeof AuditDetailsSchema>;

/** Details a client may send: few keys and short strings, so a log entry stays small. */
const DashboardAuditDetailsSchema = AuditDetailsSchema.refine(
    (details) =>
        Object.keys(details).length <= MAX_AUDIT_DETAIL_KEYS &&
        Object.values(details).every(
            (value) => typeof value !== "string" || value.length <= MAX_AUDIT_DETAIL_STRING_LENGTH,
        ),
    { message: `At most ${MAX_AUDIT_DETAIL_KEYS} keys, string values up to ${MAX_AUDIT_DETAIL_STRING_LENGTH} chars` },
);

export const BlockSchema = z.object({
    id: z.string(),
    type: BlockTypeSchema,
    targetId: SnowflakeSchema,
    reason: ReasonSchema,
    blockedBy: ActorIdSchema,
    createdAt: z.number(),
    summary: z.string(),
    leftGuild: z.boolean(),
    leftGuildCount: z.number().int(),
});
export type Block = z.infer<typeof BlockSchema>;

export const AuditEntrySchema = z.object({
    id: z.string(),
    createdAt: z.number(),
    actorId: ActorIdSchema,
    action: AuditActionSchema,
    targetType: BlockTypeSchema.nullable(),
    targetId: SnowflakeSchema.nullable(),
    details: AuditDetailsSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const GuildSummarySchema = z.object({
    guildId: SnowflakeSchema,
    name: z.string(),
    iconUrl: z.string().nullable(),
    ownerId: SnowflakeSchema,
    memberCount: z.number().int(),
    joinedAt: z.number(),
    botInstance: z.string(),
    linkedUsers: z.number().int(),
    connectedPlugins: z.number().int(),
    hasSecret: z.boolean(),
    blocked: z.boolean(),
    ownerBlocked: z.boolean(),
    leftAt: z.number().nullable(),
    purgeAt: z.number().nullable(),
});
export type GuildSummary = z.infer<typeof GuildSummarySchema>;

export const ClusterInfoSchema = z.object({
    id: z.number().int(),
    ok: z.boolean(),
    guilds: z.number().int().nullable(),
    wsPingMs: z.number().nullable(),
});
export type ClusterInfo = z.infer<typeof ClusterInfoSchema>;

export const OverviewSchema = z.object({
    mode: z.literal("hosted"),
    version: z.string(),
    uptimeSeconds: z.number(),
    guilds: z.number().int(),
    linkedUsers: z.number().int(),
    connectedPlugins: z.number().int(),
    activeGames: z.number().int(),
    blocks: z.object({ user: z.number().int(), guild: z.number().int() }),
    auditEntries24h: z.number().int(),
    clusters: z.array(ClusterInfoSchema),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const HealthSchema = z.object({ status: z.literal("ok"), mode: z.literal("hosted"), version: z.string() });
export type Health = z.infer<typeof HealthSchema>;

export const PageMetaSchema = z.object({ total: z.number().int(), page: z.number().int(), limit: z.number().int() });
export type PageMeta = z.infer<typeof PageMetaSchema>;

export const ADMIN_ERROR_CODES = [
    "unauthorized",
    "invalid-request",
    "not-found",
    "conflict",
    "payload-too-large",
    "unavailable",
    "internal",
] as const;
export const AdminErrorCodeSchema = z.enum(ADMIN_ERROR_CODES);
export type AdminErrorCode = z.infer<typeof AdminErrorCodeSchema>;

export const ADMIN_ERROR_STATUS: Record<AdminErrorCode, number> = {
    unauthorized: 401,
    "invalid-request": 400,
    "not-found": 404,
    conflict: 409,
    "payload-too-large": 413,
    unavailable: 503,
    internal: 500,
};

export interface AdminSuccess<T> {
    ok: true;
    data: T;
    meta?: PageMeta;
}

export interface AdminFailure {
    ok: false;
    error: { code: AdminErrorCode; message: string };
}

export type AdminResponse<T> = AdminSuccess<T> | AdminFailure;

/** Page 1-based; a limit above the maximum is clamped instead of rejected. */
export const PageQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .transform((limit) => Math.min(limit, MAX_PAGE_LIMIT))
        .default(DEFAULT_PAGE_LIMIT),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

const SearchSchema = z.string().max(MAX_SEARCH_LENGTH).optional();

export const GuildListQuerySchema = PageQuerySchema.extend({ q: SearchSchema });
export type GuildListQuery = z.infer<typeof GuildListQuerySchema>;

export const BlockListQuerySchema = PageQuerySchema.extend({ type: BlockTypeSchema.optional(), q: SearchSchema });
export type BlockListQuery = z.infer<typeof BlockListQuerySchema>;

export const AuditListQuerySchema = PageQuerySchema.extend({
    action: AuditActionSchema.optional(),
    actorId: ActorIdSchema.optional(),
    targetId: SnowflakeSchema.optional(),
});
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

export const CreateBlockBodySchema = z.strictObject({
    type: BlockTypeSchema,
    targetId: SnowflakeSchema,
    reason: ReasonSchema,
    actorId: SnowflakeSchema,
});
export type CreateBlockBody = z.infer<typeof CreateBlockBodySchema>;

export const RemoveBlockBodySchema = z.strictObject({ actorId: SnowflakeSchema });
export type RemoveBlockBody = z.infer<typeof RemoveBlockBodySchema>;

export const LeaveGuildBodySchema = z.strictObject({ actorId: SnowflakeSchema, reason: ReasonSchema });
export type LeaveGuildBody = z.infer<typeof LeaveGuildBodySchema>;

export const CreateAuditBodySchema = z.strictObject({
    actorId: SnowflakeSchema,
    action: DashboardAuditActionSchema,
    details: DashboardAuditDetailsSchema.optional(),
});
export type CreateAuditBody = z.infer<typeof CreateAuditBodySchema>;
