import { Op } from "sequelize";
import type { TrackedMessageModel } from "../models/TrackedMessageModel";

export type TrackedMessageKind = "link-overview" | "status" | "summary";

export interface TrackedMessage {
    guildId: string;
    kind: TrackedMessageKind;
    /** Distinguishes several messages of one kind (for example one summary per game); "" for singletons. */
    key: string;
    channelId: string;
    messageId: string;
    /** Epoch ms at which the message should be deleted, or null to keep it. */
    deleteAt: number | null;
}

/** Bot messages that are edited or deleted later, found again after a restart. */
export interface TrackedMessageRepository {
    upsert(message: TrackedMessage): Promise<void>;
    get(guildId: string, kind: TrackedMessageKind, key: string): Promise<TrackedMessage | null>;
    remove(guildId: string, kind: TrackedMessageKind, key: string): Promise<void>;
    listByGuilds(guildIds: string[], kind: TrackedMessageKind): Promise<TrackedMessage[]>;
    listDue(guildIds: string[], now: number): Promise<TrackedMessage[]>;
    deleteByGuild(guildId: string): Promise<void>;
}

function toMessage(row: TrackedMessageModel): TrackedMessage {
    return {
        guildId: row.guildId,
        kind: row.kind as TrackedMessageKind,
        key: row.key,
        channelId: row.channelId,
        messageId: row.messageId,
        deleteAt: row.deleteAt === null ? null : Number(row.deleteAt),
    };
}

export function createTrackedMessageRepository(model: typeof TrackedMessageModel): TrackedMessageRepository {
    return {
        async upsert(message) {
            await model.upsert({ ...message });
        },
        async get(guildId, kind, key) {
            const row = await model.findOne({ where: { guildId, kind, key } });
            return row ? toMessage(row) : null;
        },
        async remove(guildId, kind, key) {
            await model.destroy({ where: { guildId, kind, key } });
        },
        async listByGuilds(guildIds, kind) {
            if (guildIds.length === 0) return [];
            const rows = await model.findAll({ where: { guildId: { [Op.in]: guildIds }, kind } });
            return rows.map(toMessage);
        },
        async listDue(guildIds, now) {
            if (guildIds.length === 0) return [];
            const rows = await model.findAll({
                where: { guildId: { [Op.in]: guildIds }, deleteAt: { [Op.ne]: null, [Op.lte]: now } },
            });
            return rows.map(toMessage);
        },
        async deleteByGuild(guildId) {
            await model.destroy({ where: { guildId } });
        },
    };
}
