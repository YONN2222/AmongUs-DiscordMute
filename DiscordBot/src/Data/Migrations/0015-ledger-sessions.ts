import type { QueryInterface } from "sequelize";

/** The plugin session that last touched a ledger row; null rows belong to no running session. */
export const ledgerSessionsMigration = {
    name: "0015-ledger-sessions",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query("ALTER TABLE mute_ledger ADD COLUMN session_id VARCHAR(64)");
        await context.sequelize.query("ALTER TABLE nickname_ledger ADD COLUMN session_id VARCHAR(64)");
    },
};
