import type { QueryInterface } from "sequelize";

/** The admin user lookup finds every link of one Discord user across all guilds. */
export const linksDiscordIndexMigration = {
    name: "0018-links-discord-index",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query("CREATE INDEX links_discord_id ON links (discord_id)");
    },
};
