import type { Database } from "../Data/Database";
import type { HostedGuildRow } from "../Data/Repositories/HostedGuildRepository";
import type { PluginGateway } from "../Gateway/PluginGateway";
import type { ClusterRouter } from "../Routing/ClusterRouter";
import type {
    AuditEntry,
    AuditListQuery,
    Block,
    BlockListQuery,
    BlockType,
    ClusterInfo,
    CreateAuditBody,
    CreateBlockBody,
    GuildListQuery,
    GuildSummary,
    Health,
    LeaveGuildBody,
    Overview,
    PageQuery,
    RemoveBlockBody,
} from "./Contract";

const DAY_MS = 24 * 3600 * 1000;
const GUILD_ICON_SIZE = 128;

export interface Page<T> {
    rows: T[];
    total: number;
}

export interface AdminHandlers {
    health(): Promise<Health>;
    overview(): Promise<Overview>;
    listGuilds(query: GuildListQuery): Promise<Page<GuildSummary>>;
    getGuild(guildId: string): Promise<GuildSummary | null>;
    /** Null when the guild is not in the hosted guild list. */
    leaveGuild(guildId: string, body: LeaveGuildBody): Promise<{ left: boolean } | null>;
    listBlocks(query: BlockListQuery): Promise<Page<Block>>;
    createBlock(body: CreateBlockBody): Promise<Block | "conflict">;
    /** True when a block existed. */
    removeBlock(type: BlockType, targetId: string, body: RemoveBlockBody): Promise<boolean>;
    listAudit(query: AuditListQuery): Promise<Page<AuditEntry>>;
    recordDashboardAudit(body: CreateAuditBody): Promise<AuditEntry>;
}

export interface AdminHandlerDeps {
    db: Pick<Database, "hostedGuilds" | "guildSecrets" | "blocks" | "audit" | "telemetry" | "links">;
    plugins: Pick<PluginGateway, "sessionCount" | "sessionsOfGuild" | "disconnectGuild">;
    activeGames: () => Promise<number>;
    clusterInfo: () => Promise<ClusterInfo[]>;
    router: ClusterRouter;
    version: string;
    startedAt: number;
    now?: () => number;
}

function offsetOf({ page, limit }: PageQuery): number {
    return (page - 1) * limit;
}

function iconUrlOf(row: HostedGuildRow): string | null {
    return row.icon ? `https://cdn.discordapp.com/icons/${row.guildId}/${row.icon}.png?size=${GUILD_ICON_SIZE}` : null;
}

export function createAdminHandlers(deps: AdminHandlerDeps): AdminHandlers {
    const { db, plugins } = deps;
    const now = deps.now ?? Date.now;

    async function summarize(rows: HostedGuildRow[]): Promise<GuildSummary[]> {
        const guildIds = rows.map((row) => row.guildId);
        const [linkCounts, withSecret, blockedGuilds, blockedOwners] = await Promise.all([
            db.links.countByGuilds(guildIds),
            db.guildSecrets.hasSecrets(guildIds),
            db.blocks.blockedAmong("guild", guildIds),
            db.blocks.blockedAmong("user", [...new Set(rows.map((row) => row.ownerId))]),
        ]);
        return rows.map((row) => ({
            guildId: row.guildId,
            name: row.name,
            iconUrl: iconUrlOf(row),
            ownerId: row.ownerId,
            memberCount: row.memberCount,
            joinedAt: row.joinedAt,
            botInstance: row.botInstance,
            linkedUsers: linkCounts.get(row.guildId) ?? 0,
            connectedPlugins: plugins.sessionsOfGuild(row.guildId),
            hasSecret: withSecret.has(row.guildId),
            blocked: blockedGuilds.has(row.guildId),
            ownerBlocked: blockedOwners.has(row.ownerId),
        }));
    }

    return {
        async health() {
            return { status: "ok", mode: "hosted", version: deps.version };
        },
        async overview() {
            const [guilds, linkedUsers, activeGames, blocks, auditEntries24h, clusters] = await Promise.all([
                db.hostedGuilds.count(),
                db.telemetry.countLinkedUsers(),
                deps.activeGames(),
                db.blocks.counts(),
                db.audit.countSince(now() - DAY_MS),
                deps.clusterInfo(),
            ]);
            return {
                mode: "hosted",
                version: deps.version,
                uptimeSeconds: Math.floor((now() - deps.startedAt) / 1000),
                guilds,
                linkedUsers,
                connectedPlugins: plugins.sessionCount(),
                activeGames,
                blocks,
                auditEntries24h,
                clusters,
            };
        },
        async listGuilds(query) {
            const { rows, total } = await db.hostedGuilds.search({
                q: query.q,
                offset: offsetOf(query),
                limit: query.limit,
            });
            return { rows: await summarize(rows), total };
        },
        async getGuild(guildId) {
            const row = await db.hostedGuilds.get(guildId);
            return row ? (await summarize([row]))[0] : null;
        },
        async leaveGuild() {
            throw new Error("not implemented");
        },
        listBlocks(query) {
            return db.blocks.list({ type: query.type, targetId: query.q, offset: offsetOf(query), limit: query.limit });
        },
        async createBlock() {
            throw new Error("not implemented");
        },
        async removeBlock() {
            throw new Error("not implemented");
        },
        listAudit(query) {
            return db.audit.list({
                action: query.action,
                actorId: query.actorId,
                targetId: query.targetId,
                offset: offsetOf(query),
                limit: query.limit,
            });
        },
        async recordDashboardAudit() {
            throw new Error("not implemented");
        },
    };
}
