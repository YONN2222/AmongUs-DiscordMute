import { col, fn, QueryTypes } from "sequelize";
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
    /** Link counts of the given guilds; guilds without links are left out. */
    countByGuilds(guildIds: string[]): Promise<Map<string, number>>;
    /** One page ordered by account name (case-insensitive), then Discord id; sorted and cut in SQL. */
    listPage(guildId: string, offset: number, limit: number): Promise<LinkEntry[]>;
    findByAccountName(guildId: string, accountName: string): Promise<LinkEntry[]>;
    /** Every link of one Discord user, newest first, with the name of the guild when it is a hosted guild. */
    listByDiscordId(discordId: string): Promise<UserLinkEntry[]>;
}

export interface UserLinkEntry extends LinkEntry {
    guildName: string | null;
}

interface UserLinkDbRow {
    guild_id: string;
    discord_id: string;
    account_name: string;
    linked_at: string;
    friend_code: string | null;
    guild_name: string | null;
}

const COUNT_BATCH_SIZE = 500;

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
    const sequelize = model.sequelize;
    if (!sequelize) throw new Error("LinkModel is not initialised, call initLinkModel first");
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
        async countByGuilds(guildIds) {
            const counts = new Map<string, number>();
            for (let start = 0; start < guildIds.length; start += COUNT_BATCH_SIZE) {
                const rows = (await model.findAll({
                    attributes: ["guildId", [fn("COUNT", col("discord_id")), "total"]],
                    where: { guildId: guildIds.slice(start, start + COUNT_BATCH_SIZE) },
                    group: ["guildId"],
                    raw: true,
                })) as unknown as { guildId: string; total: number | string }[];
                for (const row of rows) counts.set(row.guildId, Number(row.total));
            }
            return counts;
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
        async listByDiscordId(discordId) {
            const rows = await sequelize.query<UserLinkDbRow>(
                `SELECT links.guild_id, links.discord_id, links.account_name, links.linked_at, links.friend_code,
                        hosted_guilds.name AS guild_name
                 FROM links LEFT JOIN hosted_guilds ON hosted_guilds.guild_id = links.guild_id
                 WHERE links.discord_id = :discordId
                 ORDER BY links.linked_at DESC, links.guild_id`,
                { replacements: { discordId }, type: QueryTypes.SELECT },
            );
            return rows.map((row) => ({
                guildId: row.guild_id,
                guildName: row.guild_name,
                discordId: row.discord_id,
                accountName: row.account_name,
                linkedAt: row.linked_at,
                friendCode: row.friend_code,
            }));
        },
    };
}
