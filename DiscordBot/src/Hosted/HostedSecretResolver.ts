import type { GuildSecretRepository } from "../Data/Repositories/GuildSecretRepository";
import type { ResolvedSecret, SecretResolver } from "../Gateway/SecretResolver";
import type { BlockChecker } from "./BlockChecker";
import { hashSecret, SECRET_PREFIX } from "./GuildSecrets";

/** Generated secrets are far shorter; anything longer is rejected before it reaches the database. */
const MAX_SECRET_LENGTH = 64;

export interface HostedSecretResolverDeps {
    secrets: Pick<GuildSecretRepository, "findGuildByHash">;
    blocks: BlockChecker;
}

/** Maps a guild secret to its guild; blocked guilds still resolve so the gateway can tell the plugin why it is refused. */
export class HostedSecretResolver implements SecretResolver {
    constructor(private readonly deps: HostedSecretResolverDeps) {}

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        if (!secret.startsWith(SECRET_PREFIX) || secret.length > MAX_SECRET_LENGTH) return null;
        const guildId = await this.deps.secrets.findGuildByHash(hashSecret(secret));
        if (!guildId) return null;
        return (await this.deps.blocks.isGuildBlocked(guildId)) ? { guildId, blocked: true } : { guildId };
    }
}
