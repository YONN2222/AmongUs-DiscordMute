import type { QueryInterface } from "sequelize";

export const botMetaMigration = {
    name: "0010-bot-meta",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            "CREATE TABLE IF NOT EXISTS bot_meta (key VARCHAR(64) PRIMARY KEY, value VARCHAR(255) NOT NULL)",
        );
    },
};
