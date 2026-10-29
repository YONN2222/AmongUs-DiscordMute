import type { QueryInterface } from "sequelize";

export const guildSettingsMigration = {
    name: "0002-guild-settings",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            `CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id VARCHAR(255) NOT NULL PRIMARY KEY,
                data TEXT NOT NULL
            )`,
        );
    },
};
