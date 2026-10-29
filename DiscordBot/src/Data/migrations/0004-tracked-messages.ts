import type { QueryInterface } from "sequelize";

export const trackedMessagesMigration = {
    name: "0004-tracked-messages",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            `CREATE TABLE IF NOT EXISTS tracked_messages (
                guild_id VARCHAR(255) NOT NULL,
                kind VARCHAR(32) NOT NULL,
                message_key VARCHAR(255) NOT NULL,
                channel_id VARCHAR(255) NOT NULL,
                message_id VARCHAR(255) NOT NULL,
                delete_at BIGINT,
                PRIMARY KEY (guild_id, kind, message_key)
            )`,
        );
    },
};
