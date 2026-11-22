import type { GuildSecretRepository } from "../Data/Repositories/GuildSecretRepository";
import { hashSecret, hasSecretFormat } from "./GuildSecrets";
import type { ResolvedSecret, SecretResolver } from "./SecretResolver";

/** Maps a secret created with /setup to the server it belongs to. */
export class GuildSecretResolver implements SecretResolver {
    constructor(private readonly secrets: Pick<GuildSecretRepository, "findGuildByHash">) {}

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        if (!hasSecretFormat(secret)) return null;
        const guildId = await this.secrets.findGuildByHash(hashSecret(secret));
        return guildId ? { guildId } : null;
    }
}
