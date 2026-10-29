import type { QueryInterface } from "sequelize";

export const linkFriendCodeMigration = {
    name: "0006-link-friend-code",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query("ALTER TABLE links ADD COLUMN friend_code VARCHAR(255)");
        await context.sequelize.query("CREATE INDEX links_guild_friend_code ON links (guild_id, friend_code)");
    },
};
