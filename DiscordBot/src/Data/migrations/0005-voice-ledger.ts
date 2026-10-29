import type { QueryInterface } from "sequelize";

/** Rows written before this column existed were mutes, hence the default of 1 for `muted`. */
export const voiceLedgerMigration = {
    name: "0005-voice-ledger",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query("ALTER TABLE mute_ledger ADD COLUMN muted INTEGER NOT NULL DEFAULT 1");
        await context.sequelize.query("ALTER TABLE mute_ledger ADD COLUMN deafened INTEGER NOT NULL DEFAULT 0");
    },
};
