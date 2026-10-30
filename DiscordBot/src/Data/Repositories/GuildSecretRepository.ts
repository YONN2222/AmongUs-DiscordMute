import { QueryTypes, type Sequelize } from "sequelize";
import { generateSecret, hashSecret } from "../../Gateway/GuildSecrets";

export interface GuildSecretInfo {
    createdAt: number;
    createdBy: string;
}

export interface RotatedSecret {
    /** The plain secret; it is never stored and cannot be read again. */
    secret: string;
    createdAt: number;
    /** True when the guild already had a secret that is now invalid. */
    replaced: boolean;
}

export interface GuildSecretRepository {
    /** Creates the guild's secret, or replaces the old one. */
    rotate(guildId: string, actorId: string, now?: number): Promise<RotatedSecret>;
    findGuildByHash(hash: string): Promise<string | null>;
    get(guildId: string): Promise<GuildSecretInfo | null>;
    /** The subset of the given guilds that have a secret. */
    hasSecrets(guildIds: string[]): Promise<Set<string>>;
}

export function createGuildSecretRepository(sequelize: Sequelize): GuildSecretRepository {
    const repository: GuildSecretRepository = {
        async rotate(guildId, actorId, now = Date.now()) {
            const replaced = (await repository.get(guildId)) !== null;
            const secret = generateSecret();
            await sequelize.query(
                `INSERT INTO guild_secrets (guild_id, secret_hash, created_at, created_by)
                 VALUES (:guildId, :hash, :now, :actorId)
                 ON CONFLICT (guild_id) DO UPDATE SET
                    secret_hash = excluded.secret_hash,
                    created_at = excluded.created_at,
                    created_by = excluded.created_by`,
                { replacements: { guildId, hash: hashSecret(secret), now, actorId } },
            );
            return { secret, createdAt: now, replaced };
        },
        async findGuildByHash(hash) {
            const rows = await sequelize.query<{ guild_id: string }>(
                "SELECT guild_id FROM guild_secrets WHERE secret_hash = :hash",
                { replacements: { hash }, type: QueryTypes.SELECT },
            );
            return rows[0]?.guild_id ?? null;
        },
        async get(guildId) {
            const rows = await sequelize.query<{ created_at: number | string; created_by: string }>(
                "SELECT created_at, created_by FROM guild_secrets WHERE guild_id = :guildId",
                { replacements: { guildId }, type: QueryTypes.SELECT },
            );
            const row = rows[0];
            return row ? { createdAt: Number(row.created_at), createdBy: row.created_by } : null;
        },
        async hasSecrets(guildIds) {
            if (guildIds.length === 0) return new Set();
            const rows = await sequelize.query<{ guild_id: string }>(
                "SELECT guild_id FROM guild_secrets WHERE guild_id IN (:guildIds)",
                { replacements: { guildIds }, type: QueryTypes.SELECT },
            );
            return new Set(rows.map((row) => row.guild_id));
        },
    };
    return repository;
}
