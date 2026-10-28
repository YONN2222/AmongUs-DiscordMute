import type { LinkModel } from "../models/LinkModel";

export interface LinkEntry {
    guildId: string;
    discordId: string;
    accountName: string;
    linkedAt: string;
}

export interface LinkRepository {
    get(guildId: string, discordId: string): Promise<LinkEntry | null>;
    upsert(guildId: string, discordId: string, accountName: string): Promise<void>;
    remove(guildId: string, discordId: string): Promise<boolean>;
    listByGuild(guildId: string): Promise<LinkEntry[]>;
    findByAccountName(guildId: string, accountName: string): Promise<LinkEntry[]>;
}

function toEntry(row: LinkModel): LinkEntry {
    return {
        guildId: row.guildId,
        discordId: row.discordId,
        accountName: row.accountName,
        linkedAt: row.linkedAt,
    };
}

export function createLinkRepository(model: typeof LinkModel): LinkRepository {
    return {
        async get(guildId, discordId) {
            const row = await model.findOne({ where: { guildId, discordId } });
            return row ? toEntry(row) : null;
        },
        async upsert(guildId, discordId, accountName) {
            await model.upsert({ guildId, discordId, accountName, linkedAt: new Date().toISOString() });
        },
        async remove(guildId, discordId) {
            return (await model.destroy({ where: { guildId, discordId } })) > 0;
        },
        async listByGuild(guildId) {
            const rows = await model.findAll({ where: { guildId } });
            return rows.map(toEntry);
        },
        async findByAccountName(guildId, accountName) {
            const rows = await model.findAll({ where: { guildId, accountName: accountName.trim() } });
            return rows.map(toEntry);
        },
    };
}
