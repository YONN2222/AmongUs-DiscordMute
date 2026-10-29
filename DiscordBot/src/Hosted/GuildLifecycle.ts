import type { AuditLogRepository } from "../Data/Repositories/AuditLogRepository";
import type { HostedGuildRepository } from "../Data/Repositories/HostedGuildRepository";
import { logger, logModules } from "../Logging/Logger";
import type { GuildLeaveReason } from "../Routing/Messages";
import type { BlockChecker } from "./BlockChecker";

const SYSTEM_ACTOR = "system";

export interface GuildInfo {
    guildId: string;
    name: string;
    icon: string | null;
    ownerId: string;
    memberCount: number;
}

/** What the lifecycle needs from Discord, so it can be tested without a client. */
export interface GuildPort {
    /** Resolves to false when the bot is not in the guild. */
    leave(guildId: string): Promise<boolean>;
    /** Cached guilds that are available, so their data can be stored. */
    cachedGuilds(): GuildInfo[];
    /** Every cached guild id, including guilds that are unavailable during an outage. */
    cachedGuildIds(): string[];
    /** Whether the guild belongs to a shard of this cluster. */
    ownsGuild(guildId: string): boolean;
    /** Every guild the bot is in, from Discord. Rejects when the list cannot be read completely. */
    fetchMemberGuildIds(): Promise<Set<string>>;
}

export type BlockLeaveReason = Exclude<GuildLeaveReason, "admin">;

/** The games of a guild, ended before the bot leaves it so nobody stays muted or renamed once its data is purged. */
export interface GuildGames {
    /** Ends every game and ignores new game events of the guild until reopen. */
    end(guildId: string): Promise<void>;
    reopen(guildId: string): void;
}

export interface GuildLifecycleDeps {
    port: GuildPort;
    hostedGuilds: HostedGuildRepository;
    blocks: Pick<BlockChecker, "isUserBlocked" | "isGuildBlocked">;
    audit: Pick<AuditLogRepository, "record">;
    games: GuildGames;
    /** Tells the plugins of a guild it is blocked before an automatic leave; the admin API does this itself. */
    disconnectBlocked: (guildId: string, reason: BlockLeaveReason) => Promise<void>;
    now?: () => number;
}

/** Keeps the hosted guild list in step with the servers the bot is in, and leaves blocked ones. */
export class GuildLifecycle {
    private readonly now: () => number;

    constructor(private readonly deps: GuildLifecycleDeps) {
        this.now = deps.now ?? Date.now;
    }

    onGuildCreate(info: GuildInfo): Promise<void> {
        return this.track(info);
    }

    onGuildUpdate(info: GuildInfo): Promise<void> {
        return this.track(info);
    }

    onGuildDelete(guildId: string): Promise<void> {
        return this.deps.hostedGuilds.purgeGuild(guildId);
    }

    /**
     * Run once the cluster is ready: stores the available cached guilds and removes the data of guilds that
     * removed the bot while it was offline. A stored guild of this cluster is purged only when it is neither cached
     * nor in the member list Discord returns; when that list cannot be read, nothing is purged.
     */
    async reconcile(): Promise<void> {
        for (const info of this.deps.port.cachedGuilds()) {
            await this.guarded(info.guildId, () => this.track(info));
        }
        await this.purgeRemovedGuilds();
    }

    /**
     * Ends the games of the guild, then leaves it; the data is purged when Discord reports the removal. The bot stays
     * when the games could not be ended. The games reopen once the leave returned, in case the bot is still there.
     * The caller audits a requested leave.
     */
    async leave(guildId: string): Promise<boolean> {
        try {
            await this.deps.games.end(guildId);
            return await this.deps.port.leave(guildId);
        } finally {
            this.deps.games.reopen(guildId);
        }
    }

    private async purgeRemovedGuilds(): Promise<void> {
        const { port, hostedGuilds } = this.deps;
        let members: Set<string>;
        try {
            members = await port.fetchMemberGuildIds();
        } catch (error) {
            logger.error(logModules.Bot, "Could not read the guild list of the bot, purging nothing", error);
            return;
        }
        const cachedIds = new Set(port.cachedGuildIds());
        for (const guildId of await hostedGuilds.listIds()) {
            if (cachedIds.has(guildId) || members.has(guildId) || !port.ownsGuild(guildId)) continue;
            await this.guarded(guildId, () => hostedGuilds.purgeGuild(guildId));
        }
    }

    private async track(info: GuildInfo): Promise<void> {
        const now = this.now();
        await this.deps.hostedGuilds.upsert({ ...info, joinedAt: now }, now);
        const reason = await this.blockReason(info);
        if (!reason) return;
        await this.deps.disconnectBlocked(info.guildId, reason);
        if (await this.leave(info.guildId)) await this.auditAutoLeave(info.guildId, reason);
    }

    private auditAutoLeave(guildId: string, reason: GuildLeaveReason): Promise<unknown> {
        return this.deps.audit.record({
            actorId: SYSTEM_ACTOR,
            action: "guild.auto-leave",
            targetType: "guild",
            targetId: guildId,
            details: { reason },
        });
    }

    private async blockReason(info: GuildInfo): Promise<BlockLeaveReason | null> {
        const { blocks } = this.deps;
        if (await blocks.isUserBlocked(info.ownerId)) return "owner-blocked";
        return (await blocks.isGuildBlocked(info.guildId)) ? "guild-blocked" : null;
    }

    private async guarded(guildId: string, work: () => Promise<void>): Promise<void> {
        try {
            await work();
        } catch (error) {
            logger.error(logModules.Bot, `Guild ${guildId}: reconciling the hosted guild list failed`, error);
        }
    }
}
