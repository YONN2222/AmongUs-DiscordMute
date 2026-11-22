import { Op } from "sequelize";
import type { PairingCodeModel } from "../Models/PairingCodeModel";

export interface PairingCode {
    guildId: string;
    /** Sent to the plugin once it is paired, so the host sees which server it joined. */
    guildName: string;
    code: string;
    expiresAt: number;
}

export interface PairingCodeRepository {
    /** Replaces the guild's previous code. Rejects when another guild holds the same code. */
    replace(pairing: PairingCode): Promise<void>;
    /** Deletes and returns the active pairing with this code; only one caller can win it. */
    consume(code: string, now: number): Promise<PairingCode | null>;
    deleteExpired(now: number): Promise<number>;
}

function toPairingCode(row: PairingCodeModel): PairingCode {
    return { guildId: row.guildId, guildName: row.guildName, code: row.code, expiresAt: Number(row.expiresAt) };
}

export function createPairingCodeRepository(model: typeof PairingCodeModel): PairingCodeRepository {
    const sequelize = model.sequelize;
    if (!sequelize) throw new Error("PairingCodeModel is not initialised, call initPairingCodeModel first");
    return {
        async replace(pairing) {
            await sequelize.transaction(async (transaction) => {
                await model.destroy({ where: { guildId: pairing.guildId }, transaction });
                await model.create({ ...pairing }, { transaction });
            });
        },
        async consume(code, now) {
            const row = await model.findOne({ where: { code, expiresAt: { [Op.gt]: now } } });
            if (!row) return null;
            const deleted = await model.destroy({ where: { guildId: row.guildId, code } });
            return deleted > 0 ? toPairingCode(row) : null;
        },
        async deleteExpired(now) {
            return model.destroy({ where: { expiresAt: { [Op.lte]: now } } });
        },
    };
}
