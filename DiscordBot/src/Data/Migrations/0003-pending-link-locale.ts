import type { QueryInterface } from "sequelize";

export const pendingLinkLocaleMigration = {
    name: "0003-pending-link-locale",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query("ALTER TABLE pending_links ADD COLUMN locale TEXT");
    },
};
