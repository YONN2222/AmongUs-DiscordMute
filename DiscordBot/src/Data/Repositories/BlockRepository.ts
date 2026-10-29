import { randomUUID } from "node:crypto";
import { QueryTypes, type Sequelize } from "sequelize";
import type { ActorId, Block, BlockType } from "../../Admin/contract";

export interface NewBlock {
    type: BlockType;
    targetId: string;
    reason: string;
    blockedBy: ActorId;
}

/** What happened when the bot acted on a new block (left the server or servers). */
export interface BlockOutcome {
    summary: string;
    leftGuild: boolean;
    leftGuildCount: number;
}

export interface BlockListOptions {
    type?: BlockType;
    targetId?: string;
    offset: number;
    limit: number;
}

export interface BlockRepository {
    /** Null when the target is already blocked. */
    create(input: NewBlock, now?: number): Promise<Block | null>;
    finish(id: string, outcome: BlockOutcome): Promise<Block>;
    /** True when a block existed. */
    remove(type: BlockType, targetId: string): Promise<boolean>;
    isBlocked(type: BlockType, targetId: string): Promise<boolean>;
    get(type: BlockType, targetId: string): Promise<Block | null>;
    /** Newest blocks first. */
    list(opts: BlockListOptions): Promise<{ rows: Block[]; total: number }>;
    counts(): Promise<{ user: number; guild: number }>;
    /** The subset of the given ids that are blocked as this type. */
    blockedAmong(type: BlockType, ids: string[]): Promise<Set<string>>;
}

interface BlockDbRow {
    id: string;
    type: BlockType;
    target_id: string;
    reason: string;
    blocked_by: string;
    created_at: number | string;
    summary: string;
    left_guild: number | string | boolean;
    left_guild_count: number | string;
}

const COLUMNS = "id, type, target_id, reason, blocked_by, created_at, summary, left_guild, left_guild_count";

function toBlock(row: BlockDbRow): Block {
    return {
        id: row.id,
        type: row.type,
        targetId: row.target_id,
        reason: row.reason,
        blockedBy: row.blocked_by,
        createdAt: Number(row.created_at),
        summary: row.summary,
        leftGuild: Number(row.left_guild) === 1,
        leftGuildCount: Number(row.left_guild_count),
    };
}

export function createBlockRepository(sequelize: Sequelize): BlockRepository {
    async function select(where: string, replacements: Record<string, unknown>): Promise<BlockDbRow[]> {
        return sequelize.query<BlockDbRow>(`SELECT ${COLUMNS} FROM blocks WHERE ${where}`, {
            replacements,
            type: QueryTypes.SELECT,
        });
    }

    const repository: BlockRepository = {
        async create({ type, targetId, reason, blockedBy }, now = Date.now()) {
            const id = randomUUID();
            await sequelize.query(
                `INSERT INTO blocks (id, type, target_id, reason, blocked_by, created_at)
                 VALUES (:id, :type, :targetId, :reason, :blockedBy, :now)
                 ON CONFLICT (type, target_id) DO NOTHING`,
                { replacements: { id, type, targetId, reason, blockedBy, now } },
            );
            const row = (await select("type = :type AND target_id = :targetId", { type, targetId }))[0];
            return row?.id === id ? toBlock(row) : null;
        },
        async finish(id, { summary, leftGuild, leftGuildCount }) {
            await sequelize.query(
                "UPDATE blocks SET summary = :summary, left_guild = :leftGuild, left_guild_count = :leftGuildCount WHERE id = :id",
                { replacements: { id, summary, leftGuild: leftGuild ? 1 : 0, leftGuildCount } },
            );
            const row = (await select("id = :id", { id }))[0];
            if (!row) throw new Error(`Block ${id} does not exist`);
            return toBlock(row);
        },
        async remove(type, targetId) {
            const existed = await repository.isBlocked(type, targetId);
            await sequelize.query("DELETE FROM blocks WHERE type = :type AND target_id = :targetId", {
                replacements: { type, targetId },
            });
            return existed;
        },
        async isBlocked(type, targetId) {
            return (await select("type = :type AND target_id = :targetId", { type, targetId })).length > 0;
        },
        async get(type, targetId) {
            const row = (await select("type = :type AND target_id = :targetId", { type, targetId }))[0];
            return row ? toBlock(row) : null;
        },
        async list({ type, targetId, offset, limit }) {
            const conditions = ["1 = 1"];
            if (type) conditions.push("type = :type");
            if (targetId) conditions.push("target_id = :targetId");
            const where = conditions.join(" AND ");
            const replacements = { type, targetId, offset, limit };
            const rows = await sequelize.query<BlockDbRow>(
                `SELECT ${COLUMNS} FROM blocks WHERE ${where}
                 ORDER BY created_at DESC, id LIMIT :limit OFFSET :offset`,
                { replacements, type: QueryTypes.SELECT },
            );
            const totals = await sequelize.query<{ total: number | string }>(
                `SELECT COUNT(*) AS total FROM blocks WHERE ${where}`,
                { replacements, type: QueryTypes.SELECT },
            );
            return { rows: rows.map(toBlock), total: Number(totals[0]?.total ?? 0) };
        },
        async counts() {
            const rows = await sequelize.query<{ type: BlockType; total: number | string }>(
                "SELECT type, COUNT(*) AS total FROM blocks GROUP BY type",
                { type: QueryTypes.SELECT },
            );
            const counts = { user: 0, guild: 0 };
            for (const row of rows) counts[row.type] = Number(row.total);
            return counts;
        },
        async blockedAmong(type, ids) {
            if (ids.length === 0) return new Set();
            const rows = await select("type = :type AND target_id IN (:ids)", { type, ids });
            return new Set(rows.map((row) => row.target_id));
        },
    };
    return repository;
}
