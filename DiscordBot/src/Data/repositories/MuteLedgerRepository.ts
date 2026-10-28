import type { MuteLedgerModel } from "../models/MuteLedgerModel";

export interface MuteLedgerEntry {
    guildId: string;
    discordId: string;
    mutedAt: number;
}

/** Members the bot itself server-muted; only these may ever be unmuted by the bot. */
export interface MuteLedgerRepository {
    add(guildId: string, discordId: string): Promise<void>;
    remove(guildId: string, discordId: string): Promise<void>;
    has(guildId: string, discordId: string): Promise<boolean>;
    listByGuild(guildId: string): Promise<MuteLedgerEntry[]>;
}

function toEntry(row: MuteLedgerModel): MuteLedgerEntry {
    return { guildId: row.guildId, discordId: row.discordId, mutedAt: Number(row.mutedAt) };
}

export function createMuteLedgerRepository(model: typeof MuteLedgerModel): MuteLedgerRepository {
    return {
        async add(guildId, discordId) {
            await model.upsert({ guildId, discordId, mutedAt: Date.now() });
        },
        async remove(guildId, discordId) {
            await model.destroy({ where: { guildId, discordId } });
        },
        async has(guildId, discordId) {
            return (await model.count({ where: { guildId, discordId } })) > 0;
        },
        async listByGuild(guildId) {
            const rows = await model.findAll({ where: { guildId } });
            return rows.map(toEntry);
        },
    };
}
