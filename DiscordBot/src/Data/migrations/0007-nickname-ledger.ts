import type { QueryInterface } from "sequelize";

export const nicknameLedgerMigration = {
    name: "0007-nickname-ledger",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            `CREATE TABLE IF NOT EXISTS nickname_ledger (
                guild_id VARCHAR(255) NOT NULL,
                discord_id VARCHAR(255) NOT NULL,
                original_nick VARCHAR(255),
                applied_nick VARCHAR(255) NOT NULL,
                PRIMARY KEY (guild_id, discord_id)
            )`,
        );
    },
};
