import { Op } from "sequelize";
import type { Locale } from "../../i18n";
import type { PendingLinkModel } from "../models/PendingLinkModel";

export interface PendingLink {
    guildId: string;
    discordId: string;
    phrase: string;
    quickChatCode: string;
    quickChatIds: [number, number];
    expiresAt: number;
    applicationId?: string;
    interactionToken?: string;
    locale?: Locale;
}

export interface PendingLinkRepository {
    getActive(guildId: string, discordId: string, now: number): Promise<PendingLink | null>;
    /** Replaces any existing pending link of the same user. Rejects when a code is already taken. */
    create(pending: PendingLink): Promise<void>;
    /** Matches the text phrase or the quick chat code; only one caller can win a given row. */
    consumeByCode(code: string, now: number): Promise<PendingLink | null>;
    attachInteraction(
        guildId: string,
        discordId: string,
        applicationId: string,
        interactionToken: string,
        locale?: Locale,
    ): Promise<void>;
    deleteExpired(now: number): Promise<number>;
}

function toPendingLink(row: PendingLinkModel): PendingLink {
    return {
        guildId: row.guildId,
        discordId: row.discordId,
        phrase: row.phrase,
        quickChatCode: row.quickChatCode,
        quickChatIds: JSON.parse(row.quickChatIds) as [number, number],
        expiresAt: Number(row.expiresAt),
        ...(row.applicationId ? { applicationId: row.applicationId } : {}),
        ...(row.interactionToken ? { interactionToken: row.interactionToken } : {}),
        ...(row.locale === "en" || row.locale === "de" ? { locale: row.locale } : {}),
    };
}

export function createPendingLinkRepository(model: typeof PendingLinkModel): PendingLinkRepository {
    const sequelize = model.sequelize;
    if (!sequelize) throw new Error("PendingLinkModel is not initialised, call initPendingLinkModel first");
    return {
        async getActive(guildId, discordId, now) {
            const row = await model.findOne({ where: { guildId, discordId, expiresAt: { [Op.gt]: now } } });
            return row ? toPendingLink(row) : null;
        },
        async create(pending) {
            await sequelize.transaction(async (transaction) => {
                await model.destroy({
                    where: { guildId: pending.guildId, discordId: pending.discordId },
                    transaction,
                });
                await model.create(
                    {
                        guildId: pending.guildId,
                        discordId: pending.discordId,
                        phrase: pending.phrase,
                        quickChatCode: pending.quickChatCode,
                        quickChatIds: JSON.stringify(pending.quickChatIds),
                        expiresAt: pending.expiresAt,
                        applicationId: pending.applicationId ?? null,
                        interactionToken: pending.interactionToken ?? null,
                        locale: pending.locale ?? null,
                    },
                    { transaction },
                );
            });
        },
        async consumeByCode(code, now) {
            const row = await model.findOne({
                where: { [Op.or]: [{ phrase: code }, { quickChatCode: code }], expiresAt: { [Op.gt]: now } },
            });
            if (!row) return null;
            const deleted = await model.destroy({
                where: { guildId: row.guildId, discordId: row.discordId, phrase: row.phrase },
            });
            return deleted > 0 ? toPendingLink(row) : null;
        },
        async attachInteraction(guildId, discordId, applicationId, interactionToken, locale) {
            await model.update(
                { applicationId, interactionToken, locale: locale ?? null },
                { where: { guildId, discordId } },
            );
        },
        async deleteExpired(now) {
            return model.destroy({ where: { expiresAt: { [Op.lte]: now } } });
        },
    };
}
