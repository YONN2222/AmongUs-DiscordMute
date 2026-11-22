import type { DeviceTokenRepository } from "../Data/Repositories/DeviceTokenRepository";
import type { GuildSecretRepository } from "../Data/Repositories/GuildSecretRepository";
import type { HostedGuildRepository } from "../Data/Repositories/HostedGuildRepository";
import { DeviceTokenResolver } from "../Gateway/DeviceTokenResolver";
import { GuildSecretResolver } from "../Gateway/GuildSecretResolver";
import { ChainedSecretResolver, type ResolvedSecret, type SecretResolver } from "../Gateway/SecretResolver";
import type { BlockChecker } from "./BlockChecker";

export interface HostedSecretResolverDeps {
    secrets: Pick<GuildSecretRepository, "findGuildByHash">;
    deviceTokens: Pick<DeviceTokenRepository, "use">;
    blocks: BlockChecker;
    hostedGuilds: Pick<HostedGuildRepository, "get">;
}

/**
 * Maps a guild secret or a paired device token to its guild; blocked guilds still resolve so the gateway can tell the
 * plugin why it is refused. Neither resolves for a guild the bot left until the bot is added back.
 */
export class HostedSecretResolver implements SecretResolver {
    private readonly secrets: SecretResolver;

    constructor(private readonly deps: HostedSecretResolverDeps) {
        this.secrets = new ChainedSecretResolver([
            new GuildSecretResolver(deps.secrets),
            new DeviceTokenResolver(deps.deviceTokens),
        ]);
    }

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        const resolved = await this.secrets.resolve(secret);
        if (!resolved || (await this.isLeft(resolved.guildId))) return null;
        const { guildId } = resolved;
        return (await this.deps.blocks.isGuildBlocked(guildId)) ? { guildId, blocked: true } : { guildId };
    }

    private async isLeft(guildId: string): Promise<boolean> {
        const guild = await this.deps.hostedGuilds.get(guildId);
        return guild !== null && guild.leftAt !== null;
    }
}
