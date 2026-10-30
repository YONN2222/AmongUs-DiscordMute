import { QueryTypes, type Sequelize } from "sequelize";

/** How long the data of a guild is kept after the bot left it, so adding the bot back keeps the setup. */
export const LEFT_GUILD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface HostedGuildRow {
    guildId: string;
    name: string;
    icon: string | null;
    ownerId: string;
    memberCount: number;
    joinedAt: number;
    botInstance: string;
    updatedAt: number;
    /** When the bot left the guild; null while it is a member. */
    leftAt: number | null;
}

export type HostedGuildInput = Omit<HostedGuildRow, "botInstance" | "updatedAt" | "leftAt">;

export interface HostedGuildSearch {
    /** Case-insensitive literal substring of the name, or an exact guild id. */
    q?: string;
    offset: number;
    limit: number;
}

export interface HostedGuildRepository {
    /** Inserts the guild or refreshes its name, icon, owner and member count; joinedAt, botInstance and leftAt stay. */
    upsert(row: HostedGuildInput, now?: number): Promise<void>;
    get(guildId: string): Promise<HostedGuildRow | null>;
    /** Guilds of the owner the bot is still in. */
    listByOwner(ownerId: string): Promise<HostedGuildRow[]>;
    /** Guilds the bot is still in. */
    listIds(): Promise<string[]>;
    /** Newest guilds first, including guilds the bot left. */
    search(opts: HostedGuildSearch): Promise<{ rows: HostedGuildRow[]; total: number }>;
    /** Guilds the bot is still in. */
    count(): Promise<number>;
    /** Records when the bot left; a guild that already left keeps its first time. */
    markLeft(guildId: string, now: number): Promise<void>;
    clearLeft(guildId: string): Promise<void>;
    /** Guilds the bot left at or before the cutoff. */
    listLeftBefore(cutoff: number): Promise<string[]>;
    /** Deletes everything stored for the guild. Blocks and the audit log stay. */
    purgeGuild(guildId: string): Promise<void>;
}

interface HostedGuildDbRow {
    guild_id: string;
    name: string;
    icon: string | null;
    owner_id: string;
    member_count: number | string;
    joined_at: number | string;
    bot_instance: string;
    updated_at: number | string;
    left_at: number | string | null;
}

const COLUMNS = "guild_id, name, icon, owner_id, member_count, joined_at, bot_instance, updated_at, left_at";
const LIKE_ESCAPE = "\\";

/** Every table that holds data of a single guild. */
export const GUILD_SCOPED_TABLES = [
    "links",
    "pending_links",
    "guild_settings",
    "tracked_messages",
    "mute_ledger",
    "nickname_ledger",
    "guild_secrets",
    "hosted_guilds",
] as const;

function toRow(row: HostedGuildDbRow): HostedGuildRow {
    return {
        guildId: row.guild_id,
        name: row.name,
        icon: row.icon,
        ownerId: row.owner_id,
        memberCount: Number(row.member_count),
        joinedAt: Number(row.joined_at),
        botInstance: row.bot_instance,
        updatedAt: Number(row.updated_at),
        leftAt: row.left_at === null ? null : Number(row.left_at),
    };
}

function escapeLike(text: string): string {
    return text.replace(/[\\%_]/g, (char) => LIKE_ESCAPE + char);
}

export function createHostedGuildRepository(sequelize: Sequelize): HostedGuildRepository {
    return {
        async upsert(row, now = Date.now()) {
            await sequelize.query(
                `INSERT INTO hosted_guilds (guild_id, name, icon, owner_id, member_count, joined_at, updated_at)
                 VALUES (:guildId, :name, :icon, :ownerId, :memberCount, :joinedAt, :now)
                 ON CONFLICT (guild_id) DO UPDATE SET
                    name = excluded.name,
                    icon = excluded.icon,
                    owner_id = excluded.owner_id,
                    member_count = excluded.member_count,
                    updated_at = excluded.updated_at`,
                { replacements: { ...row, now } },
            );
        },
        async get(guildId) {
            const rows = await sequelize.query<HostedGuildDbRow>(
                `SELECT ${COLUMNS} FROM hosted_guilds WHERE guild_id = :guildId`,
                { replacements: { guildId }, type: QueryTypes.SELECT },
            );
            return rows[0] ? toRow(rows[0]) : null;
        },
        async listByOwner(ownerId) {
            const rows = await sequelize.query<HostedGuildDbRow>(
                `SELECT ${COLUMNS} FROM hosted_guilds WHERE owner_id = :ownerId AND left_at IS NULL
                 ORDER BY joined_at DESC, guild_id`,
                { replacements: { ownerId }, type: QueryTypes.SELECT },
            );
            return rows.map(toRow);
        },
        async listIds() {
            const rows = await sequelize.query<{ guild_id: string }>(
                "SELECT guild_id FROM hosted_guilds WHERE left_at IS NULL",
                {
                    type: QueryTypes.SELECT,
                },
            );
            return rows.map((row) => row.guild_id);
        },
        async search({ q, offset, limit }) {
            const query = q?.trim();
            const filter = query ? `WHERE LOWER(name) LIKE :pattern ESCAPE '${LIKE_ESCAPE}' OR guild_id = :query` : "";
            const replacements = {
                pattern: `%${escapeLike((query ?? "").toLowerCase())}%`,
                query: query ?? "",
                offset,
                limit,
            };
            const rows = await sequelize.query<HostedGuildDbRow>(
                `SELECT ${COLUMNS} FROM hosted_guilds ${filter}
                 ORDER BY joined_at DESC, guild_id LIMIT :limit OFFSET :offset`,
                { replacements, type: QueryTypes.SELECT },
            );
            const totals = await sequelize.query<{ total: number | string }>(
                `SELECT COUNT(*) AS total FROM hosted_guilds ${filter}`,
                { replacements, type: QueryTypes.SELECT },
            );
            return { rows: rows.map(toRow), total: Number(totals[0]?.total ?? 0) };
        },
        async count() {
            const rows = await sequelize.query<{ total: number | string }>(
                "SELECT COUNT(*) AS total FROM hosted_guilds WHERE left_at IS NULL",
                { type: QueryTypes.SELECT },
            );
            return Number(rows[0]?.total ?? 0);
        },
        async markLeft(guildId, now) {
            await sequelize.query(
                "UPDATE hosted_guilds SET left_at = :now WHERE guild_id = :guildId AND left_at IS NULL",
                { replacements: { guildId, now } },
            );
        },
        async clearLeft(guildId) {
            await sequelize.query("UPDATE hosted_guilds SET left_at = NULL WHERE guild_id = :guildId", {
                replacements: { guildId },
            });
        },
        async listLeftBefore(cutoff) {
            const rows = await sequelize.query<{ guild_id: string }>(
                "SELECT guild_id FROM hosted_guilds WHERE left_at <= :cutoff",
                { replacements: { cutoff }, type: QueryTypes.SELECT },
            );
            return rows.map((row) => row.guild_id);
        },
        async purgeGuild(guildId) {
            await sequelize.transaction(async (transaction) => {
                for (const table of GUILD_SCOPED_TABLES) {
                    await sequelize.query(`DELETE FROM ${table} WHERE guild_id = :guildId`, {
                        replacements: { guildId },
                        transaction,
                    });
                }
            });
        },
    };
}
