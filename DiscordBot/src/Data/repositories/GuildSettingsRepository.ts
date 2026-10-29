import { type GuildSettings, parseSettings } from "../../Settings/GuildSettings";
import type { GuildSettingsModel } from "../models/GuildSettingsModel";

export interface GuildSettingsRepository {
    /** Unknown guilds and unreadable rows yield the defaults. */
    get(guildId: string): Promise<GuildSettings>;
    save(guildId: string, settings: GuildSettings): Promise<void>;
    delete(guildId: string): Promise<void>;
}

function parseStored(data: string): GuildSettings {
    try {
        return parseSettings(JSON.parse(data));
    } catch {
        return parseSettings({});
    }
}

export function createGuildSettingsRepository(model: typeof GuildSettingsModel): GuildSettingsRepository {
    if (!model.sequelize) throw new Error("GuildSettingsModel is not initialised, call initGuildSettingsModel first");
    return {
        async get(guildId) {
            const row = await model.findOne({ where: { guildId } });
            return row ? parseStored(row.data) : parseSettings({});
        },
        async save(guildId, settings) {
            await model.upsert({ guildId, data: JSON.stringify(settings) });
        },
        async delete(guildId) {
            await model.destroy({ where: { guildId } });
        },
    };
}
