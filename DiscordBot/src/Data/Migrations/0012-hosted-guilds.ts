import type { QueryInterface } from "sequelize";

export const hostedGuildsMigration = {
    name: "0012-hosted-guilds",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            `CREATE TABLE IF NOT EXISTS hosted_guilds (
                guild_id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(64),
                owner_id VARCHAR(255) NOT NULL,
                member_count INTEGER NOT NULL DEFAULT 0,
                joined_at BIGINT NOT NULL,
                bot_instance VARCHAR(32) NOT NULL DEFAULT 'default',
                updated_at BIGINT NOT NULL
            )`,
        );
        await context.sequelize.query("CREATE INDEX IF NOT EXISTS hosted_guilds_owner ON hosted_guilds (owner_id)");
    },
};
