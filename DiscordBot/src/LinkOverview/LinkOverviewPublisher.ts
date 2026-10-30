import type { MessagePayload, MessagePort } from "../Cluster/MessagePort";
import { editOrPost, ThrottledRefresh, unusableChannelFailure } from "../Cluster/TrackedMessagePublishing";
import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import type { PendingLinkRepository } from "../Data/Repositories/PendingLinkRepository";
import type { TrackedMessage, TrackedMessageRepository } from "../Data/Repositories/TrackedMessageRepository";
import type { GuildEvent } from "../Events/GuildEvents";
import { logger, logModules } from "../Logging/Logger";
import type { GuildSettings } from "../Settings/GuildSettings";
import type { SettingsService } from "../Settings/SettingsService";
import { PAGE_SIZE, PENDING_SHOWN, renderLinkOverview } from "./RenderLinkOverview";

const KIND = "link-overview";
const DEFAULT_MIN_INTERVAL_MS = 5000;
const WARN_INTERVAL_MS = 10 * 60_000;
const RESUME_SPACING_MS = 250;

export interface LinkOverviewPublisherDeps {
    port: MessagePort;
    links: Pick<LinkRepository, "countByGuild" | "listPage">;
    pending: Pick<PendingLinkRepository, "listActiveByGuild" | "countActive">;
    tracked: Pick<TrackedMessageRepository, "get" | "upsert" | "remove" | "listByGuilds">;
    settings: Pick<SettingsService, "get">;
    minIntervalMs?: number;
    now?: () => number;
}

interface GuildState {
    refresher: ThrottledRefresh;
    expiryTimer?: ReturnType<typeof setTimeout>;
    /** Counts triggers (events, explicit refreshes); a failure that needs a trigger to retry is pinned to it. */
    triggerSeq: number;
    blockedSeq?: number;
    lastWarnAt?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Keeps the public link overview message of every guild up to date without flooding the Discord API. */
export class LinkOverviewPublisher {
    private readonly guilds = new Map<string, GuildState>();
    private readonly minIntervalMs: number;
    private readonly now: () => number;

    constructor(private readonly deps: LinkOverviewPublisherDeps) {
        this.minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
        this.now = deps.now ?? Date.now;
    }

    /** Requests an update: at most one edit per interval, and the last request is always honoured. */
    schedule(guildId: string): void {
        const state = this.stateOf(guildId);
        state.triggerSeq += 1;
        state.refresher.request();
    }

    /** Updates right away, ignoring the interval, and resolves once the update is done. */
    async refreshNow(guildId: string): Promise<void> {
        const state = this.stateOf(guildId);
        state.triggerSeq += 1;
        await state.refresher.run();
    }

    handle(event: GuildEvent): void {
        switch (event.type) {
            case "link-changed":
                this.schedule(event.guildId);
                return;
            case "pending-changed":
                this.deps.settings
                    .get(event.guildId)
                    .then((settings) => {
                        if (settings.linkOverview.showPending) this.schedule(event.guildId);
                    })
                    .catch((error: unknown) => {
                        logger.error(logModules.Bot, `Guild ${event.guildId}: could not read settings`, error);
                    });
                return;
            case "settings-changed":
                if (event.paths.some((path) => path.startsWith("linkOverview") || path === "language")) {
                    this.schedule(event.guildId);
                }
                return;
            default:
                return;
        }
    }

    /** Refreshes every guild that already has an overview, spread out so a restart does not burst the API. */
    async resume(guildIds: string[]): Promise<void> {
        const rows = await this.deps.tracked.listByGuilds(guildIds, KIND);
        for (const [index, row] of rows.entries()) {
            if (index > 0) await sleep(RESUME_SPACING_MS);
            await this.refreshNow(row.guildId);
        }
    }

    private stateOf(guildId: string): GuildState {
        let state = this.guilds.get(guildId);
        if (!state) {
            const created: GuildState = {
                refresher: new ThrottledRefresh({
                    minIntervalMs: this.minIntervalMs,
                    now: this.now,
                    refresh: () => this.refresh(guildId, created),
                }),
                triggerSeq: 0,
            };
            state = created;
            this.guilds.set(guildId, state);
        }
        return state;
    }

    /** Never rejects: a failing refresh is logged and the next trigger tries again. */
    private async refresh(guildId: string, state: GuildState): Promise<void> {
        try {
            if (state.blockedSeq === state.triggerSeq) return;
            const seq = state.triggerSeq;
            const settings = await this.deps.settings.get(guildId);
            const channelId = settings.linkOverview.channelId;
            let tracked = await this.deps.tracked.get(guildId, KIND, "");
            if (tracked && tracked.channelId !== channelId) {
                await this.discard(tracked);
                tracked = null;
            }
            if (!channelId) return;

            const view = await this.render(guildId, settings);
            const blocked = await this.publish(guildId, state, channelId, tracked, { components: view.components });
            if (blocked) state.blockedSeq = seq;
            this.scheduleExpiry(guildId, state, view.nextExpiry);
        } catch (error) {
            logger.error(logModules.Bot, `Guild ${guildId}: could not update the link overview`, error);
        }
    }

    private async discard(tracked: TrackedMessage): Promise<void> {
        await this.deps.port.delete(tracked.channelId, tracked.messageId).catch(() => {});
        await this.deps.tracked.remove(tracked.guildId, KIND, "");
    }

    private async render(
        guildId: string,
        settings: GuildSettings,
    ): Promise<{ components: unknown[]; nextExpiry: number | null }> {
        const [entries, total] = await Promise.all([
            this.deps.links.listPage(guildId, 0, PAGE_SIZE),
            this.deps.links.countByGuild(guildId),
        ]);
        let pending: { discordIds: string[]; total: number } | undefined;
        let nextExpiry: number | null = null;
        if (settings.linkOverview.showPending) {
            const now = this.now();
            const [rows, pendingTotal] = await Promise.all([
                this.deps.pending.listActiveByGuild(guildId, now, PENDING_SHOWN),
                this.deps.pending.countActive(guildId, now),
            ]);
            pending = { discordIds: rows.map((row) => row.discordId), total: pendingTotal };
            nextExpiry = rows.length > 0 ? Math.min(...rows.map((row) => row.expiresAt)) : null;
        }
        const components = renderLinkOverview({
            entries,
            total,
            page: 0,
            ...(pending ? { pending } : {}),
            locale: settings.language,
            mode: "public",
            isAdmin: false,
        });
        return { components, nextExpiry };
    }

    /** Edits the tracked message, or posts a new one when there is none or it was deleted. True when blocked. */
    private async publish(
        guildId: string,
        state: GuildState,
        channelId: string,
        tracked: TrackedMessage | null,
        payload: MessagePayload,
    ): Promise<boolean> {
        try {
            const messageId = await editOrPost(this.deps.port, tracked, channelId, payload);
            if (messageId === null) return false;
            await this.deps.tracked.upsert({ guildId, kind: KIND, key: "", channelId, messageId, deleteAt: null });
            return false;
        } catch (error) {
            return this.onFailure(guildId, state, channelId, error);
        }
    }

    private onFailure(guildId: string, state: GuildState, channelId: string, error: unknown): boolean {
        const failure = unusableChannelFailure(error);
        if (!failure) {
            logger.error(logModules.Bot, `Guild ${guildId}: could not update the link overview`, error);
            return false;
        }
        const now = this.now();
        if (state.lastWarnAt === undefined || now - state.lastWarnAt >= WARN_INTERVAL_MS) {
            state.lastWarnAt = now;
            logger.warn(
                logModules.Bot,
                `Cannot update the link overview in ${channelId} of guild ${guildId} (${failure}); waiting for the next change`,
            );
        }
        return true;
    }

    private scheduleExpiry(guildId: string, state: GuildState, nextExpiry: number | null): void {
        if (state.expiryTimer) clearTimeout(state.expiryTimer);
        state.expiryTimer = undefined;
        if (nextExpiry === null) return;
        state.expiryTimer = setTimeout(
            () => {
                state.expiryTimer = undefined;
                this.schedule(guildId);
            },
            Math.max(0, nextExpiry - this.now()) + 1,
        );
        state.expiryTimer.unref?.();
    }
}
