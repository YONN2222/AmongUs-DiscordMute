import type { QueryInterface } from "sequelize";

/** When the bot left a hosted guild; its data is deleted a while later unless the bot is added back. */
export const hostedGuildLeftAtMigration = {
    name: "0016-hosted-guild-left-at",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query("ALTER TABLE hosted_guilds ADD COLUMN left_at BIGINT NULL");
    },
};
