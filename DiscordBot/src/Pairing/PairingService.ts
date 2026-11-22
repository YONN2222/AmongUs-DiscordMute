import { UniqueConstraintError } from "sequelize";
import type { Database } from "../Data/Database";
import { describePhrase, formatQuickChatCode, pickQuickChatPhrases } from "../Linking/QuickChatCatalog";
import type { Platform } from "../Protocol/PluginProtocol";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_PHRASE_COUNT = 3;
/** A new code only collides with the active code of another guild, so a few tries are plenty. */
const MAX_CODE_ATTEMPTS = 5;

export interface IssuedPairingCode {
    /** The Quick Chat phrases to send, as "Label (Category)". */
    phrases: string[];
    expiresAt: number;
}

export interface PairedDevice {
    guildId: string;
    guildName: string;
    /** The device token the plugin stores and sends as its secret from now on. */
    secret: string;
}

/** Connects a device without typing a secret: /setup shows Quick Chat phrases, the host sends them in the lobby. */
export class PairingService {
    constructor(private readonly db: Pick<Database, "pairingCodes" | "deviceTokens">) {}

    /** A new code replaces the guild's previous one, so a guild has one active code at a time. */
    async createCode(guildId: string, guildName: string, now: number = Date.now()): Promise<IssuedPairingCode> {
        await this.db.pairingCodes.deleteExpired(now);
        const expiresAt = now + PAIRING_CODE_TTL_MS;
        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            const ids = pickQuickChatPhrases(PAIRING_PHRASE_COUNT).map((phrase) => phrase.id);
            try {
                await this.db.pairingCodes.replace({ guildId, guildName, code: formatQuickChatCode(ids), expiresAt });
            } catch (error) {
                if (error instanceof UniqueConstraintError) continue;
                throw error;
            }
            return { phrases: ids.map(describePhrase), expiresAt };
        }
        throw new Error(`Could not find a free pairing code for guild ${guildId}`);
    }

    /** Uses up the code and creates a device token for its guild; null when no active code matches. */
    async pair(code: string, platform: Platform, now: number = Date.now()): Promise<PairedDevice | null> {
        const pairing = await this.db.pairingCodes.consume(code, now);
        if (!pairing) return null;
        const secret = await this.db.deviceTokens.create(pairing.guildId, platform, now);
        return { guildId: pairing.guildId, guildName: pairing.guildName, secret };
    }
}
