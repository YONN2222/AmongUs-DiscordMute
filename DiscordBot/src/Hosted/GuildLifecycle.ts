import { SYSTEM_ACTOR } from "../Admin/Contract";
import type { AuditLogRepository } from "../Data/Repositories/AuditLogRepository";
import type { HostedGuildRepository } from "../Data/Repositories/HostedGuildRepository";
import { logger, logModules } from "../Logging/Logger";
import type { GuildLeaveReason } from "../Routing/Messages";
import type { BlockChecker } from "./BlockChecker";

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

/** The games of a guild, ended before the bot leaves it so nobody stays muted or renamed by the bot afterwards. */
export interface GuildGames {
    /** Ends every game and ignores new game events of the guild until reopen. */
    end(guildId: string): Promise<void>;
    reopen(guildId: string): void;
    /**
     * The bot was removed and cannot change anything in the guild: drops its games in memory and ignores its game
     * events until recover, keeping the mute and nickname ledger.
     */
    forget(guildId: string): void;
    /** Lifts every mute and puts back every nickname still on record, then serves the guild's games again. */
    recover(guildId: string): Promise<void>;
}

export interface GuildLifecycleDeps {
    port: GuildPort;
    hostedGuilds: HostedGuildRepository;
    blocks: Pick<BlockChecker, "isUserBlocked" | "isGuildBlocked">;
    audit: Pick<AuditLogRepository, "record">;
    games: GuildGames;
    /** Tells the plugins of a guild it is blocked before an automatic leave; the admin API does this itself. */
    disconnectBlocked: (guildId: string, reason: BlockLeaveReason) => Promise<void>;
    /** Tells the plugins of a guild that removed the bot that it is gone. */
    disconnectRemoved: (guildId: string) => Promise<void>;
    now?: () => number;
}

/**
 * Keeps the hosted guild list in step with the servers the bot is in, and leaves blocked ones. A guild the bot left
 * keeps its data with a leave time; adding the bot back clears it, the hourly cleanup deletes the data later.
 */
export class GuildLifecycle {
    private readonly now: () => number;

    constructor(private readonly deps: GuildLifecycleDeps) {
        this.now = deps.now ?? Date.now;
    }

    /** A guild that added the bot back may still have mutes and nicknames on record, which are lifted first. */
    async onGuildCreate(info: GuildInfo): Promise<void> {
        await this.deps.games.recover(info.guildId);
        await this.track(info);
    }

    onGuildUpdate(info: GuildInfo): Promise<void> {
        return this.track(info);
    }

    /**
     * The bot is no longer in the guild, so it makes no Discord calls there: its games end in memory only, the mute
     * and nickname ledger stays until the bot is added back or the data is deleted.
     */
    async onGuildDelete(guildId: string): Promise<void> {
        this.deps.games.forget(guildId);
        await this.deps.hostedGuilds.markLeft(guildId, this.now());
        await this.deps.disconnectRemoved(guildId);
    }

    /**
     * Run once the cluster is ready: stores the available cached guilds and marks guilds that removed the bot while
     * it was offline as left. A stored guild of this cluster counts as removed only when it is neither cached nor in
     * the member list Discord returns; when that list cannot be read, nothing is marked.
     */
    async reconcile(): Promise<void> {
        for (const info of this.deps.port.cachedGuilds()) {
            await this.guarded(info.guildId, () => this.track(info));
        }
        await this.markRemovedGuilds();
    }

    /**
     * Ends the games of the guild, then leaves it; the guild is marked as left when Discord reports it. The bot stays
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

    private async markRemovedGuilds(): Promise<void> {
        const { port, hostedGuilds } = this.deps;
        let members: Set<string>;
        try {
            members = await port.fetchMemberGuildIds();
        } catch (error) {
            logger.error(logModules.Bot, "Could not read the guild list of the bot, marking no guild as left", error);
            return;
        }
        const cachedIds = new Set(port.cachedGuildIds());
        for (const guildId of await hostedGuilds.listIds()) {
            if (cachedIds.has(guildId) || members.has(guildId) || !port.ownsGuild(guildId)) continue;
            await this.guarded(guildId, () => this.onGuildDelete(guildId));
        }
    }

    /** A blocked guild is left again at once and keeps the leave time of its first removal. */
    private async track(info: GuildInfo): Promise<void> {
        const now = this.now();
        await this.deps.hostedGuilds.upsert({ ...info, joinedAt: now }, now);
        const reason = await this.blockReason(info);
        if (!reason) {
            await this.deps.hostedGuilds.clearLeft(info.guildId);
            return;
        }
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
