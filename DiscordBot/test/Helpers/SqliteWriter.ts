import type { Database } from "../../src/Data/Database";

/** The ledger and pending link writes a gateway or cluster process makes, repeated against one database. */
export async function writeRepeatedly(db: Database, prefix: string, iterations: number): Promise<void> {
    const guildId = `${prefix}-guild`;
    for (let i = 0; i < iterations; i++) {
        const discordId = `${prefix}-u${i}`;
        await db.muteLedger.set(guildId, discordId, { muted: true, deafened: false }, null);
        await db.pendingLinks.create({
            guildId,
            discordId,
            phrase: `${prefix}-phrase-${i}`,
            quickChatCode: `${prefix}-qc-${i}`,
            quickChatIds: [1, 2],
            expiresAt: Date.now() + 60_000,
        });
        await db.pendingLinks.consumeByCode(guildId, `${prefix}-phrase-${i}`, Date.now());
        await db.muteLedger.remove(guildId, discordId);
    }
}
