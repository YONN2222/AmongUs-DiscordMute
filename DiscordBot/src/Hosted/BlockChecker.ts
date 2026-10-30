import type { BlockRepository } from "../Data/Repositories/BlockRepository";
import type { HostedGuildRepository } from "../Data/Repositories/HostedGuildRepository";

export interface BlockCheckerDeps {
    blocks: Pick<BlockRepository, "isBlocked">;
    hostedGuilds: Pick<HostedGuildRepository, "get">;
}

/** Answers whether a user, or a guild together with its owner, is on the block list. */
export class BlockChecker {
    constructor(private readonly deps: BlockCheckerDeps) {}

    isUserBlocked(userId: string): Promise<boolean> {
        return this.deps.blocks.isBlocked("user", userId);
    }

    /** A guild counts as blocked when it is blocked itself or when the owner stored for it is blocked. */
    async isGuildBlocked(guildId: string): Promise<boolean> {
        if (await this.deps.blocks.isBlocked("guild", guildId)) return true;
        const guild = await this.deps.hostedGuilds.get(guildId);
        return guild !== null && (await this.isUserBlocked(guild.ownerId));
    }
}
