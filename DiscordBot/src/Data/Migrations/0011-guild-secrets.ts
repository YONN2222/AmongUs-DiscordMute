import type { QueryInterface } from "sequelize";

export const guildSecretsMigration = {
    name: "0011-guild-secrets",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            `CREATE TABLE IF NOT EXISTS guild_secrets (
                guild_id VARCHAR(255) PRIMARY KEY,
                secret_hash CHAR(64) NOT NULL UNIQUE,
                created_at BIGINT NOT NULL,
                created_by VARCHAR(255) NOT NULL
            )`,
        );
    },
};
