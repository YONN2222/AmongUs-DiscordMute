import type { Database } from "../Data/Database";
import type { BlockOutcome } from "../Data/Repositories/BlockRepository";
import type { HostedGuildRow } from "../Data/Repositories/HostedGuildRepository";
import type { PluginGateway } from "../Gateway/PluginGateway";
import { LEAVE_DISCONNECTS } from "../Hosted/LeaveDisconnects";
import { purgeAtOf, purgeGuildData } from "../Hosted/LeftGuildPurge";
import type { ClusterRouter } from "../Routing/ClusterRouter";
import type { GuildLeaveReason, RouterReply } from "../Routing/Messages";
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
    PurgeGuildBody,
    RemoveBlockBody,
} from "./Contract";

const DAY_MS = 24 * 3600 * 1000;
const GUILD_ICON_SIZE = 128;
const USER_BLOCK_LEAVE_BUDGET_MS = 30_000;

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
    /** Deletes the data of a server the bot left; null when the guild is not in the hosted guild list. */
    purgeGuild(guildId: string, body: PurgeGuildBody): Promise<"purged" | "in-guild" | null>;
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
            leftAt: row.leftAt,
            purgeAt: purgeAtOf(row.leftAt),
        }));
    }

    /** Tells the plugin why it is disconnected, then lets the owning cluster end the games and leave. */
    async function leaveThroughCluster(guildId: string, reason: GuildLeaveReason): Promise<RouterReply> {
        const disconnect = LEAVE_DISCONNECTS[reason];
        plugins.disconnectGuild(guildId, disconnect.code, disconnect.reason);
        return deps.router.send(guildId, { kind: "leave-guild", guildId, reason });
    }

    async function leaveBlockedGuild(guildId: string): Promise<BlockOutcome> {
        const guild = await db.hostedGuilds.get(guildId);
        if (!guild || guild.leftAt !== null) {
            return { summary: "Bot was not in the server", leftGuild: false, leftGuildCount: 0 };
        }
        const reply = await leaveThroughCluster(guildId, "guild-blocked");
        if (reply.ok) return { summary: "Left the server", leftGuild: true, leftGuildCount: 1 };
        return { summary: `Leaving the server failed: ${reply.error}`, leftGuild: false, leftGuildCount: 0 };
    }

    /** Leaves one server after the other; servers still waiting when the time budget is used up count as not left. */
    async function leaveGuildsOfBlockedUser(ownerId: string): Promise<BlockOutcome> {
        const owned = await db.hostedGuilds.listByOwner(ownerId);
        if (owned.length === 0) {
            return { summary: "No servers owned by this user", leftGuild: false, leftGuildCount: 0 };
        }
        const deadline = now() + USER_BLOCK_LEAVE_BUDGET_MS;
        let left = 0;
        for (const guild of owned) {
            if (now() >= deadline) break;
            if ((await leaveThroughCluster(guild.guildId, "owner-blocked")).ok) left += 1;
        }
        const summary =
            left === owned.length
                ? `Left ${left} server(s) owned by this user`
                : `Left ${left} of ${owned.length} server(s) owned by this user`;
        return { summary, leftGuild: left > 0, leftGuildCount: left };
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
        async leaveGuild(guildId, { actorId, reason }) {
            const guild = await db.hostedGuilds.get(guildId);
            if (!guild) return null;
            // The bot is no longer in a guild it left, so no cluster is asked to leave it again.
            const left = guild.leftAt === null && (await leaveThroughCluster(guildId, "admin")).ok;
            await db.audit.record(
                { actorId, action: "guild.leave", targetType: "guild", targetId: guildId, details: { reason, left } },
                now(),
            );
            return { left };
        },
        async purgeGuild(guildId, { actorId }) {
            const guild = await db.hostedGuilds.get(guildId);
            if (!guild) return null;
            if (guild.leftAt === null) return "in-guild";
            await purgeGuildData(db, guildId, actorId, now());
            return "purged";
        },
        listBlocks(query) {
            return db.blocks.list({ type: query.type, targetId: query.q, offset: offsetOf(query), limit: query.limit });
        },
        async createBlock({ type, targetId, reason, actorId }) {
            const created = await db.blocks.create({ type, targetId, reason, blockedBy: actorId }, now());
            if (!created) return "conflict";
            const outcome =
                type === "guild" ? await leaveBlockedGuild(targetId) : await leaveGuildsOfBlockedUser(targetId);
            const block = await db.blocks.finish(created.id, outcome);
            await db.audit.record(
                {
                    actorId,
                    action: "block.create",
                    targetType: type,
                    targetId,
                    details: { reason, leftGuildCount: outcome.leftGuildCount },
                },
                now(),
            );
            return block;
        },
        async removeBlock(type, targetId, { actorId }) {
            const removed = await db.blocks.remove(type, targetId);
            if (removed) {
                await db.audit.record({ actorId, action: "block.remove", targetType: type, targetId }, now());
            }
            return removed;
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
        recordDashboardAudit({ actorId, action, details }) {
            return db.audit.record({ actorId, action, details }, now());
        },
    };
}
