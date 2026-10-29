import { col, fn } from "sequelize";
import { matchesAccountName } from "../AccountNameMatch";
import type { LinkModel } from "../Models/LinkModel";

export interface LinkEntry {
    guildId: string;
    discordId: string;
    accountName: string;
    linkedAt: string;
    friendCode: string | null;
}

export interface LinkRepository {
    get(guildId: string, discordId: string): Promise<LinkEntry | null>;
    /** Keeps a stored friend code while the account name stays the same and clears it when the name changes. */
    upsert(guildId: string, discordId: string, accountName: string): Promise<void>;
    setFriendCode(guildId: string, discordId: string, friendCode: string): Promise<void>;
    findByFriendCode(guildId: string, friendCode: string): Promise<LinkEntry[]>;
    rename(guildId: string, discordId: string, accountName: string): Promise<void>;
    remove(guildId: string, discordId: string): Promise<boolean>;
    listByGuild(guildId: string): Promise<LinkEntry[]>;
    countByGuild(guildId: string): Promise<number>;
    /** One page ordered by account name (case-insensitive), then Discord id; sorted and cut in SQL. */
    listPage(guildId: string, offset: number, limit: number): Promise<LinkEntry[]>;
    findByAccountName(guildId: string, accountName: string): Promise<LinkEntry[]>;
}

function toEntry(row: LinkModel): LinkEntry {
    return {
        guildId: row.guildId,
        discordId: row.discordId,
        accountName: row.accountName,
        linkedAt: row.linkedAt,
        friendCode: row.friendCode ?? null,
    };
}

export function createLinkRepository(model: typeof LinkModel): LinkRepository {
    return {
        async get(guildId, discordId) {
            const row = await model.findOne({ where: { guildId, discordId } });
            return row ? toEntry(row) : null;
        },
        async upsert(guildId, discordId, accountName) {
            const existing = await model.findOne({ where: { guildId, discordId } });
            const linkedAt = new Date().toISOString();
            // The code belongs to the old account, so a different name must not inherit it.
            if (existing && existing.accountName !== accountName) {
                await model.upsert({ guildId, discordId, accountName, linkedAt, friendCode: null });
                return;
            }
            await model.upsert({ guildId, discordId, accountName, linkedAt });
        },
        async setFriendCode(guildId, discordId, friendCode) {
            await model.update({ friendCode }, { where: { guildId, discordId } });
        },
        async findByFriendCode(guildId, friendCode) {
            const rows = await model.findAll({ where: { guildId, friendCode } });
            return rows.map(toEntry);
        },
        async rename(guildId, discordId, accountName) {
            await model.update({ accountName }, { where: { guildId, discordId } });
        },
        async remove(guildId, discordId) {
            return (await model.destroy({ where: { guildId, discordId } })) > 0;
        },
        async listByGuild(guildId) {
            const rows = await model.findAll({ where: { guildId } });
            return rows.map(toEntry);
        },
        async countByGuild(guildId) {
            return model.count({ where: { guildId } });
        },
        async listPage(guildId, offset, limit) {
            const rows = await model.findAll({
                where: { guildId },
                order: [
                    [fn("LOWER", col("account_name")), "ASC"],
                    ["discordId", "ASC"],
                ],
                offset,
                limit,
            });
            return rows.map(toEntry);
        },
        async findByAccountName(guildId, accountName) {
            const rows = await model.findAll({ where: { guildId } });
            return rows.filter((row) => matchesAccountName(row.accountName, accountName)).map(toEntry);
        },
    };
}
