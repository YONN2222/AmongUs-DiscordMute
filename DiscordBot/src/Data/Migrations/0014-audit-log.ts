import type { QueryInterface } from "sequelize";

export const auditLogMigration = {
    name: "0014-audit-log",
    async up({ context }: { context: QueryInterface }): Promise<void> {
        await context.sequelize.query(
            `CREATE TABLE IF NOT EXISTS audit_log (
                id VARCHAR(36) PRIMARY KEY,
                created_at BIGINT NOT NULL,
                actor_id VARCHAR(255) NOT NULL,
                action VARCHAR(64) NOT NULL,
                target_type VARCHAR(8),
                target_id VARCHAR(255),
                details TEXT NOT NULL
            )`,
        );
        await context.sequelize.query("CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at)");
    },
};
