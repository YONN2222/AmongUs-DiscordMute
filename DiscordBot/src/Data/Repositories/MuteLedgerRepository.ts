import { Op } from "sequelize";
import type { MuteLedgerModel } from "../Models/MuteLedgerModel";

export interface LedgerFlags {
    muted: boolean;
    deafened: boolean;
}

export interface MuteLedgerEntry extends LedgerFlags {
    guildId: string;
    discordId: string;
    mutedAt: number;
}

const GUILD_BATCH = 500;

/** What the bot itself server-muted or server-deafened; only these flags may ever be lifted by the bot. */
export interface MuteLedgerRepository {
    get(guildId: string, discordId: string): Promise<MuteLedgerEntry | null>;
    /** Stores both flags at once; neither flag set removes the row. */
    set(guildId: string, discordId: string, flags: LedgerFlags): Promise<void>;
    /** Marks a mute and leaves a recorded deafen as it is. */
    add(guildId: string, discordId: string): Promise<void>;
    remove(guildId: string, discordId: string): Promise<void>;
    has(guildId: string, discordId: string): Promise<boolean>;
    listByGuild(guildId: string): Promise<MuteLedgerEntry[]>;
    listByGuilds(guildIds: string[]): Promise<MuteLedgerEntry[]>;
}

function toEntry(row: MuteLedgerModel): MuteLedgerEntry {
    return {
        guildId: row.guildId,
        discordId: row.discordId,
        mutedAt: Number(row.mutedAt),
        muted: Number(row.muted) !== 0,
        deafened: Number(row.deafened) !== 0,
    };
}

export function createMuteLedgerRepository(model: typeof MuteLedgerModel): MuteLedgerRepository {
    const repository: MuteLedgerRepository = {
        async get(guildId, discordId) {
            const row = await model.findOne({ where: { guildId, discordId } });
            return row ? toEntry(row) : null;
        },
        async set(guildId, discordId, flags) {
            if (!flags.muted && !flags.deafened) {
                await model.destroy({ where: { guildId, discordId } });
                return;
            }
            await model.upsert({
                guildId,
                discordId,
                mutedAt: Date.now(),
                muted: flags.muted ? 1 : 0,
                deafened: flags.deafened ? 1 : 0,
            });
        },
        async add(guildId, discordId) {
            const existing = await repository.get(guildId, discordId);
            await repository.set(guildId, discordId, { muted: true, deafened: existing?.deafened ?? false });
        },
        async remove(guildId, discordId) {
            await model.destroy({ where: { guildId, discordId } });
        },
        async has(guildId, discordId) {
            return (await model.count({ where: { guildId, discordId } })) > 0;
        },
        async listByGuild(guildId) {
            const rows = await model.findAll({ where: { guildId } });
            return rows.map(toEntry);
        },
        async listByGuilds(guildIds) {
            const entries: MuteLedgerEntry[] = [];
            for (let start = 0; start < guildIds.length; start += GUILD_BATCH) {
                const batch = guildIds.slice(start, start + GUILD_BATCH);
                const rows = await model.findAll({ where: { guildId: { [Op.in]: batch } } });
                entries.push(...rows.map(toEntry));
            }
            return entries;
        },
    };
    return repository;
}
