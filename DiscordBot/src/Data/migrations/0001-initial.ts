import type { QueryInterface } from "sequelize";

const STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS links (
        guild_id VARCHAR(255) NOT NULL,
        discord_id VARCHAR(255) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        linked_at VARCHAR(255) NOT NULL,
        PRIMARY KEY (guild_id, discord_id)
    )`,
    "CREATE INDEX IF NOT EXISTS links_guild_account_name ON links (guild_id, account_name)",
    `CREATE TABLE IF NOT EXISTS pending_links (
        guild_id VARCHAR(255) NOT NULL,
        discord_id VARCHAR(255) NOT NULL,
        phrase VARCHAR(255) NOT NULL UNIQUE,
        quick_chat_code VARCHAR(255) NOT NULL UNIQUE,
        quick_chat_ids VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL,
        application_id VARCHAR(255),
        interaction_token VARCHAR(255),
        PRIMARY KEY (guild_id, discord_id)
    )`,
    `CREATE TABLE IF NOT EXISTS mute_ledger (
        guild_id VARCHAR(255) NOT NULL,
        discord_id VARCHAR(255) NOT NULL,
        muted_at BIGINT NOT NULL,
        PRIMARY KEY (guild_id, discord_id)
    )`,
];

export const initialMigration = {
    name: "0001-initial",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        for (const statement of STATEMENTS) {
            await context.sequelize.query(statement);
        }
    },
};
