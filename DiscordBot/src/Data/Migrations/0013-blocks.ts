import type { QueryInterface } from "sequelize";

export const blocksMigration = {
    name: "0013-blocks",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            `CREATE TABLE IF NOT EXISTS blocks (
                id VARCHAR(36) PRIMARY KEY,
                type VARCHAR(8) NOT NULL CHECK (type IN ('user', 'guild')),
                target_id VARCHAR(255) NOT NULL,
                reason VARCHAR(500) NOT NULL,
                blocked_by VARCHAR(255) NOT NULL,
                created_at BIGINT NOT NULL,
                summary VARCHAR(500) NOT NULL DEFAULT '',
                left_guild INTEGER NOT NULL DEFAULT 0,
                left_guild_count INTEGER NOT NULL DEFAULT 0,
                UNIQUE (type, target_id)
            )`,
        );
    },
};
