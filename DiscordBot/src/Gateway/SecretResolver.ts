import { createHash, timingSafeEqual } from "node:crypto";

export interface ResolvedSecret {
    guildId: string;
    /** The guild exists but may not use the bot; the gateway refuses it with a clear close reason. */
    blocked?: boolean;
}

export interface SecretResolver {
    resolve(secret: string): Promise<ResolvedSecret | null>;
}

/** Asks the resolvers in order and answers with the first match. */
export class ChainedSecretResolver implements SecretResolver {
    constructor(private readonly resolvers: readonly SecretResolver[]) {}

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        for (const resolver of this.resolvers) {
            const resolved = await resolver.resolve(secret);
            if (resolved) return resolved;
        }
        return null;
    }
}

function digest(value: string): Buffer {
    return createHash("sha256").update(value).digest();
}

/** The deprecated `secret` of config.json: one shared secret for the one server named by `guildId`. */
export class SelfHostSecretResolver implements SecretResolver {
    private readonly expected: Buffer;

    constructor(private readonly config: { secret: string; guildId: string }) {
        this.expected = digest(config.secret);
    }

    async resolve(secret: string): Promise<ResolvedSecret | null> {
        // Hashing both sides gives equal-length buffers, so the length of the secret does not leak.
        return timingSafeEqual(digest(secret), this.expected) ? { guildId: this.config.guildId } : null;
    }
}
