import type { QueryInterface } from "sequelize";

const COLUMNS =
    "guild_id, discord_id, phrase, quick_chat_code, quick_chat_ids, expires_at, application_id, interaction_token, locale";

/** Link codes were unique across all guilds; now each guild has its own codes. Open links are kept. */
const STATEMENTS = [
    `CREATE TABLE pending_links_scoped (
        guild_id VARCHAR(255) NOT NULL,
        discord_id VARCHAR(255) NOT NULL,
        phrase VARCHAR(255) NOT NULL,
        quick_chat_code VARCHAR(255) NOT NULL,
        quick_chat_ids VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL,
        application_id TEXT,
        interaction_token TEXT,
        locale TEXT,
        PRIMARY KEY (guild_id, discord_id)
    )`,
    `INSERT INTO pending_links_scoped (${COLUMNS}) SELECT ${COLUMNS} FROM pending_links`,
    "DROP TABLE pending_links",
    "ALTER TABLE pending_links_scoped RENAME TO pending_links",
    "CREATE UNIQUE INDEX pending_links_guild_phrase ON pending_links (guild_id, phrase)",
    "CREATE UNIQUE INDEX pending_links_guild_quick_chat_code ON pending_links (guild_id, quick_chat_code)",
];

export const pendingLinkGuildCodesMigration = {
    name: "0017-pending-link-guild-codes",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.transaction(async (transaction) => {
            for (const statement of STATEMENTS) {
                await context.sequelize.query(statement, { transaction });
            }
        });
    },
};
