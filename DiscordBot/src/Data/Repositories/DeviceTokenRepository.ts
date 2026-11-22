import { randomUUID } from "node:crypto";
import { generateSecret, hashSecret } from "../../Gateway/GuildSecrets";
import type { Platform } from "../../Protocol/PluginProtocol";
import type { DeviceTokenModel } from "../Models/DeviceTokenModel";

export interface DeviceToken {
    id: string;
    guildId: string;
    platform: Platform;
    createdAt: number;
    /** When the device last connected; null until its first connection. */
    lastUsedAt: number | null;
}

export interface DeviceTokenRepository {
    /** Creates a token for a paired device and returns it; only its hash is stored, it cannot be read again. */
    create(guildId: string, platform: Platform, now: number): Promise<string>;
    /** The guild of the token with this hash, recording the use; null when no token matches. */
    use(tokenHash: string, now: number): Promise<string | null>;
    /** The guild's devices, newest first. */
    list(guildId: string, limit: number): Promise<DeviceToken[]>;
    /** Resolves to false when the guild has no device with this id. */
    remove(guildId: string, id: string): Promise<boolean>;
}

function toDeviceToken(row: DeviceTokenModel): DeviceToken {
    return {
        id: row.id,
        guildId: row.guildId,
        platform: row.platform as Platform,
        createdAt: Number(row.createdAt),
        lastUsedAt: row.lastUsedAt === null ? null : Number(row.lastUsedAt),
    };
}

export function createDeviceTokenRepository(model: typeof DeviceTokenModel): DeviceTokenRepository {
    return {
        async create(guildId, platform, now) {
            const token = generateSecret();
            await model.create({
                id: randomUUID(),
                guildId,
                tokenHash: hashSecret(token),
                platform,
                createdAt: now,
                lastUsedAt: null,
            });
            return token;
        },
        async use(tokenHash, now) {
            const row = await model.findOne({ where: { tokenHash } });
            if (!row) return null;
            await model.update({ lastUsedAt: now }, { where: { id: row.id } });
            return row.guildId;
        },
        async list(guildId, limit) {
            const rows = await model.findAll({
                where: { guildId },
                order: [
                    ["createdAt", "DESC"],
                    ["id", "ASC"],
                ],
                limit,
            });
            return rows.map(toDeviceToken);
        },
        async remove(guildId, id) {
            return (await model.destroy({ where: { guildId, id } })) > 0;
        },
    };
}
