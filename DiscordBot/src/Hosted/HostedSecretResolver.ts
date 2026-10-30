import type { GuildSecretRepository } from "../Data/Repositories/GuildSecretRepository";
import type { HostedGuildRepository } from "../Data/Repositories/HostedGuildRepository";
import { GuildSecretResolver } from "../Gateway/GuildSecretResolver";
import type { ResolvedSecret, SecretResolver } from "../Gateway/SecretResolver";
import type { BlockChecker } from "./BlockChecker";

export interface HostedSecretResolverDeps {
    secrets: Pick<GuildSecretRepository, "findGuildByHash">;
    blocks: BlockChecker;
    hostedGuilds: Pick<HostedGuildRepository, "get">;
}

/**
 * Maps a guild secret to its guild; blocked guilds still resolve so the gateway can tell the plugin why it is refused.
 * The secret of a guild the bot left does not resolve until the bot is added back.
 */
export class HostedSecretResolver implements SecretResolver {
    private readonly guildSecrets: GuildSecretResolver;

    constructor(private readonly deps: HostedSecretResolverDeps) {
        this.guildSecrets = new GuildSecretResolver(deps.secrets);
    }

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        const resolved = await this.guildSecrets.resolve(secret);
        if (!resolved || (await this.isLeft(resolved.guildId))) return null;
        const { guildId } = resolved;
        return (await this.deps.blocks.isGuildBlocked(guildId)) ? { guildId, blocked: true } : { guildId };
    }

    private async isLeft(guildId: string): Promise<boolean> {
        const guild = await this.deps.hostedGuilds.get(guildId);
        return guild !== null && guild.leftAt !== null;
    }
}
