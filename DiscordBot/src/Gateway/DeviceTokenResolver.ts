import type { DeviceTokenRepository } from "../Data/Repositories/DeviceTokenRepository";
import { hashSecret, hasSecretFormat } from "./GuildSecrets";
import type { ResolvedSecret, SecretResolver } from "./SecretResolver";

/** Maps the token of a device paired in /setup to its server and records when the device last connected. */
export class DeviceTokenResolver implements SecretResolver {
    constructor(
        private readonly tokens: Pick<DeviceTokenRepository, "use">,
        private readonly now: () => number = Date.now,
    ) {}

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        if (!hasSecretFormat(secret)) return null;
        const guildId = await this.tokens.use(hashSecret(secret), this.now());
        return guildId ? { guildId } : null;
    }
}
