import { randomUUID } from "node:crypto";
import type { MessagePort } from "../Cluster/MessagePort";
import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import type { TrackedMessageRepository } from "../Data/Repositories/TrackedMessageRepository";
import type { GuildEvent } from "../Events/GuildEvents";
import { logger, logModules } from "../Logging/Logger";
import type { SettingsService } from "../Settings/SettingsService";
import { createNameResolver } from "./PlayerNames";
import { renderSummary } from "./RenderSummary";

const MS_PER_MINUTE = 60_000;

export interface MatchSummaryDeps {
    port: Pick<MessagePort, "post">;
    tracked: Pick<TrackedMessageRepository, "upsert">;
    links: Pick<LinkRepository, "listByGuild">;
    settings: Pick<SettingsService, "get">;
    now?: () => number;
}

/** Posts a summary after every finished game and schedules its deletion when the guild wants that. */
export class MatchSummary {
    private readonly startedAt = new Map<string, number>();
    private readonly now: () => number;

    constructor(private readonly deps: MatchSummaryDeps) {
        this.now = deps.now ?? Date.now;
    }

    async handle(event: GuildEvent): Promise<void> {
        switch (event.type) {
            case "game-event":
                if (event.event === "game-start") {
                    if (!this.startedAt.has(event.sessionId)) this.startedAt.set(event.sessionId, this.now());
                } else if (event.event === "lobby") {
                    this.startedAt.delete(event.sessionId);
                }
                return;
            case "session-ended":
                this.startedAt.delete(event.sessionId);
                return;
            case "game-ended":
                await this.post(event);
                return;
            default:
                return;
        }
    }

    private async post(event: Extract<GuildEvent, { type: "game-ended" }>): Promise<void> {
        const started = this.startedAt.get(event.sessionId);
        this.startedAt.delete(event.sessionId);
        try {
            const settings = await this.deps.settings.get(event.guildId);
            const channelId = settings.summary.channelId;
            if (!channelId) return;

            const resolve = createNameResolver(await this.deps.links.listByGuild(event.guildId));
            const components = renderSummary({
                reason: event.reason,
                winners: event.winners,
                winnerDiscordIds: event.winners.map(resolve),
                players: event.roster.map((entry) => ({
                    name: entry.name,
                    discordId: resolve(entry.name),
                    dead: entry.dead,
                })),
                durationMs: started === undefined ? null : this.now() - started,
                locale: settings.language,
            });
            const messageId = await this.deps.port.post(channelId, { components });

            const minutes = settings.summary.deleteAfterMinutes;
            if (minutes > 0) {
                await this.deps.tracked.upsert({
                    guildId: event.guildId,
                    kind: "summary",
                    key: randomUUID(),
                    channelId,
                    messageId,
                    deleteAt: this.now() + minutes * MS_PER_MINUTE,
                });
            }
        } catch (error) {
            logger.error(logModules.Bot, `Guild ${event.guildId}: could not post the match summary`, error);
        }
    }
}
