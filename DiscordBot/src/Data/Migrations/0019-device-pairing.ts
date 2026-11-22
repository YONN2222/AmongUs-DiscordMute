import type { QueryInterface } from "sequelize";

/** Pairing codes are matched across all guilds, so a code is unique everywhere; a guild has one code at a time. */
const STATEMENTS = [
    `CREATE TABLE pairing_codes (
        guild_id VARCHAR(255) PRIMARY KEY,
        guild_name VARCHAR(255) NOT NULL,
        code VARCHAR(64) NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL
    )`,
    `CREATE TABLE device_tokens (
        id VARCHAR(36) PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        platform VARCHAR(16) NOT NULL,
        created_at BIGINT NOT NULL,
        last_used_at BIGINT
    )`,
    "CREATE INDEX device_tokens_guild_id ON device_tokens (guild_id)",
];

export const devicePairingMigration = {
    name: "0019-device-pairing",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.transaction(async (transaction) => {
            for (const statement of STATEMENTS) {
                await context.sequelize.query(statement, { transaction });
            }
        });
    },
};
