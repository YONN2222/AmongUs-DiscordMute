import type { GuildSecretRepository } from "../Data/Repositories/GuildSecretRepository";
import { hashSecret, SECRET_PREFIX } from "./GuildSecrets";
import type { ResolvedSecret, SecretResolver } from "./SecretResolver";

/** Generated secrets are far shorter; anything longer is rejected before it reaches the database. */
const MAX_SECRET_LENGTH = 64;

/** Maps a secret created with /setup to the server it belongs to. */
export class GuildSecretResolver implements SecretResolver {
    constructor(private readonly secrets: Pick<GuildSecretRepository, "findGuildByHash">) {}

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        if (!secret.startsWith(SECRET_PREFIX) || secret.length > MAX_SECRET_LENGTH) return null;
        const guildId = await this.secrets.findGuildByHash(hashSecret(secret));
        return guildId ? { guildId } : null;
    }
}
