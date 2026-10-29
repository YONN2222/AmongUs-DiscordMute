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
    cachedGuilds(): GuildInfo[];
    /** Whether the guild belongs to a shard of this cluster. */
    ownsGuild(guildId: string): boolean;
    /** True only when Discord says the guild does not exist for the bot; errors and doubts are false. */
    isGone(guildId: string): Promise<boolean>;
}

export interface GuildLifecycleDeps {
    port: GuildPort;
    hostedGuilds: HostedGuildRepository;
    blocks: Pick<BlockChecker, "isUserBlocked" | "isGuildBlocked">;
    audit: Pick<AuditLogRepository, "record">;
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
     * Run once the cluster is ready: stores the cached guilds and removes the data of guilds the bot was removed from
     * while it was offline. A guild missing from the cache is only purged when Discord confirms it is gone.
     */
    async reconcile(): Promise<void> {
        const cached = this.deps.port.cachedGuilds();
        for (const info of cached) {
            await this.guarded(info.guildId, () => this.track(info));
        }
        const cachedIds = new Set(cached.map((info) => info.guildId));
        for (const guildId of await this.deps.hostedGuilds.listIds()) {
            if (cachedIds.has(guildId) || !this.deps.port.ownsGuild(guildId)) continue;
            await this.guarded(guildId, async () => {
                if (await this.deps.port.isGone(guildId)) await this.deps.hostedGuilds.purgeGuild(guildId);
            });
        }
    }

    /** Leaves the guild; the data is purged when Discord reports the removal. */
    async leave(guildId: string, reason: GuildLeaveReason): Promise<boolean> {
        const left = await this.deps.port.leave(guildId);
        if (left && reason !== "admin") {
            await this.deps.audit.record({
                actorId: SYSTEM_ACTOR,
                action: "guild.auto-leave",
                targetType: "guild",
                targetId: guildId,
                details: { reason },
            });
        }
        return left;
    }

    private async track(info: GuildInfo): Promise<void> {
        const now = this.now();
        await this.deps.hostedGuilds.upsert({ ...info, joinedAt: now }, now);
        const reason = await this.blockReason(info);
        if (reason) await this.leave(info.guildId, reason);
    }

    private async blockReason(info: GuildInfo): Promise<GuildLeaveReason | null> {
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
