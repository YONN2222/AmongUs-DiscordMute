import { Op } from "sequelize";
import type { NicknameLedgerModel } from "../Models/NicknameLedgerModel";

export interface NicknameLedgerEntry {
    guildId: string;
    discordId: string;
    originalNick: string | null;
    appliedNick: string;
}

const GUILD_BATCH = 500;

/** The nicknames the bot changed, so only a nickname it set itself is ever put back. */
export interface NicknameLedgerRepository {
    set(guildId: string, discordId: string, originalNick: string | null, appliedNick: string): Promise<void>;
    listByGuild(guildId: string): Promise<NicknameLedgerEntry[]>;
    listByGuilds(guildIds: string[]): Promise<NicknameLedgerEntry[]>;
    remove(guildId: string, discordId: string): Promise<void>;
}

function toEntry(row: NicknameLedgerModel): NicknameLedgerEntry {
    return {
        guildId: row.guildId,
        discordId: row.discordId,
        originalNick: row.originalNick,
        appliedNick: row.appliedNick,
    };
}

export function createNicknameLedgerRepository(model: typeof NicknameLedgerModel): NicknameLedgerRepository {
    return {
        async set(guildId, discordId, originalNick, appliedNick) {
            await model.upsert({ guildId, discordId, originalNick, appliedNick });
        },
        async listByGuild(guildId) {
            const rows = await model.findAll({ where: { guildId } });
            return rows.map(toEntry);
        },
        async listByGuilds(guildIds) {
            const entries: NicknameLedgerEntry[] = [];
            for (let start = 0; start < guildIds.length; start += GUILD_BATCH) {
                const batch = guildIds.slice(start, start + GUILD_BATCH);
                const rows = await model.findAll({ where: { guildId: { [Op.in]: batch } } });
                entries.push(...rows.map(toEntry));
            }
            return entries;
        },
        async remove(guildId, discordId) {
            await model.destroy({ where: { guildId, discordId } });
        },
    };
}
