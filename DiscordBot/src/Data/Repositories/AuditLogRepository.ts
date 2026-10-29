import { randomUUID } from "node:crypto";
import { QueryTypes, type Sequelize } from "sequelize";
import type { ActorId, AuditAction, AuditDetails, AuditEntry, BlockType } from "../../Admin/contract";

export const AUDIT_RETENTION_MS = 180 * 24 * 3600 * 1000;

export interface NewAuditEntry {
    actorId: ActorId;
    action: AuditAction;
    targetType?: BlockType;
    targetId?: string;
    details?: AuditDetails;
}

export interface AuditListOptions {
    action?: AuditAction;
    actorId?: string;
    targetId?: string;
    offset: number;
    limit: number;
}

/** Never put secrets in `details`; the log is shown in the admin dashboard. */
export interface AuditLogRepository {
    record(entry: NewAuditEntry, now?: number): Promise<AuditEntry>;
    /** Newest entries first. */
    list(opts: AuditListOptions): Promise<{ rows: AuditEntry[]; total: number }>;
    countSince(since: number): Promise<number>;
    /** Deletes entries created before the cutoff and returns how many. */
    pruneOlderThan(cutoff: number): Promise<number>;
}

interface AuditDbRow {
    id: string;
    created_at: number | string;
    actor_id: string;
    action: AuditAction;
    target_type: BlockType | null;
    target_id: string | null;
    details: string;
}

const COLUMNS = "id, created_at, actor_id, action, target_type, target_id, details";

function toEntry(row: AuditDbRow): AuditEntry {
    return {
        id: row.id,
        createdAt: Number(row.created_at),
        actorId: row.actor_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: JSON.parse(row.details) as AuditDetails,
    };
}

export function createAuditLogRepository(sequelize: Sequelize): AuditLogRepository {
    return {
        async record({ actorId, action, targetType, targetId, details = {} }, now = Date.now()) {
            const entry: AuditEntry = {
                id: randomUUID(),
                createdAt: now,
                actorId,
                action,
                targetType: targetType ?? null,
                targetId: targetId ?? null,
                details,
            };
            await sequelize.query(
                `INSERT INTO audit_log (${COLUMNS})
                 VALUES (:id, :createdAt, :actorId, :action, :targetType, :targetId, :details)`,
                { replacements: { ...entry, details: JSON.stringify(details) } },
            );
            return entry;
        },
        async list({ action, actorId, targetId, offset, limit }) {
            const conditions = ["1 = 1"];
            if (action) conditions.push("action = :action");
            if (actorId) conditions.push("actor_id = :actorId");
            if (targetId) conditions.push("target_id = :targetId");
            const where = conditions.join(" AND ");
            const replacements = { action, actorId, targetId, offset, limit };
            const rows = await sequelize.query<AuditDbRow>(
                `SELECT ${COLUMNS} FROM audit_log WHERE ${where}
                 ORDER BY created_at DESC, id LIMIT :limit OFFSET :offset`,
                { replacements, type: QueryTypes.SELECT },
            );
            const totals = await sequelize.query<{ total: number | string }>(
                `SELECT COUNT(*) AS total FROM audit_log WHERE ${where}`,
                { replacements, type: QueryTypes.SELECT },
            );
            return { rows: rows.map(toEntry), total: Number(totals[0]?.total ?? 0) };
        },
        async countSince(since) {
            const rows = await sequelize.query<{ total: number | string }>(
                "SELECT COUNT(*) AS total FROM audit_log WHERE created_at >= :since",
                { replacements: { since }, type: QueryTypes.SELECT },
            );
            return Number(rows[0]?.total ?? 0);
        },
        async pruneOlderThan(cutoff) {
            const deleted = await sequelize.query<{ id: string }>(
                "DELETE FROM audit_log WHERE created_at < :cutoff RETURNING id",
                { replacements: { cutoff }, type: QueryTypes.SELECT },
            );
            return deleted.length;
        },
    };
}
