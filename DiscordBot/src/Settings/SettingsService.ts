import type { GuildSettingsRepository } from "../Data/repositories/GuildSettingsRepository";
import type { GuildEventSink } from "../Events/GuildEvents";
import { GuildQueue } from "../Utils/GuildQueue";
import { diffSettings, type GuildSettings, mergeSettings, type SettingsPatch } from "./GuildSettings";

export class SettingsService {
    private readonly cache = new Map<string, GuildSettings>();
    private readonly queue = new GuildQueue();

    constructor(
        private readonly repo: GuildSettingsRepository,
        private readonly events?: GuildEventSink,
    ) {}

    async get(guildId: string): Promise<GuildSettings> {
        const cached = this.cache.get(guildId);
        if (cached) return cached;
        const loaded = await this.repo.get(guildId);
        // A write that finished while the read was in flight is newer than the loaded row.
        const current = this.cache.get(guildId);
        if (current) return current;
        this.cache.set(guildId, loaded);
        return loaded;
    }

    update(
        guildId: string,
        actorId: string,
        patch: SettingsPatch,
    ): Promise<{ before: GuildSettings; after: GuildSettings }> {
        return this.queue.run(guildId, async () => {
            const before = await this.get(guildId);
            const after = mergeSettings(before, patch);
            await this.repo.save(guildId, after);
            this.cache.set(guildId, after);
            const paths = diffSettings(before, after);
            if (paths.length > 0) {
                this.events?.emit({ type: "settings-changed", guildId, actorId, paths, before, after });
            }
            return { before, after };
        });
    }
}
