import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import type { GuildEventBus } from "../Events/GuildEvents";
import { relinkFromRoster } from "../Game/AutoRelink";
import type { NicknameSync } from "../Game/NicknameSync";
import { logger, logModules } from "../Logging/Logger";
import type { MuteService } from "../Mute/MuteService";
import { type ClusterRequest, parseClusterRequest, type RouterReply } from "../Routing/Messages";
import type { SettingsService } from "../Settings/SettingsService";

export type ConfirmedLinkReply = Omit<Extract<ClusterRequest, { kind: "link-confirmed" }>, "kind">;

type GameEventRequest = Extract<ClusterRequest, { kind: "game-event" }>;

export interface ClusterRequestHandlerDeps {
    mute: Pick<MuteService, "handleGameEvent" | "endSession">;
    /** Resolves to false when the original /link reply could not be updated. */
    updateLinkReply: (link: ConfirmedLinkReply) => Promise<boolean>;
    /** False until startup recovery ran, so recovery can never undo a mute applied before it. */
    isReady: () => boolean;
    events: Pick<GuildEventBus, "emit">;
    links: LinkRepository;
    settings: Pick<SettingsService, "get">;
    nicknames?: Pick<NicknameSync, "restoreGuild">;
    onLinkConfirmed?: (link: ConfirmedLinkReply) => Promise<void>;
}

/** Runs ahead of the mute update so the same request already mutes by the renamed link; never blocks the mute. */
async function relinkSafely(deps: ClusterRequestHandlerDeps, req: GameEventRequest): Promise<void> {
    if (!req.roster || req.roster.length === 0) return;
    try {
        if (!(await deps.settings.get(req.guildId)).autoRelink) return;
        await relinkFromRoster(deps, req.guildId, req.roster);
    } catch (error) {
        logger.error(logModules.Bot, `Guild ${req.guildId}: relinking players by friend code failed`, error);
    }
}

/** Awaited with the mute release so the restore is not cut off when the cluster stops right after. */
async function restoreNicknames(deps: ClusterRequestHandlerDeps, guildId: string): Promise<void> {
    try {
        await deps.nicknames?.restoreGuild(guildId);
    } catch (error) {
        logger.error(logModules.Bot, `Guild ${guildId}: restoring nicknames failed`, error);
    }
}

async function handleGameEvent(deps: ClusterRequestHandlerDeps, req: GameEventRequest): Promise<RouterReply> {
    await relinkSafely(deps, req);
    const { channelIds, ...reply } = await deps.mute.handleGameEvent(req);
    const { kind: _kind, ...event } = req;
    const usedChannels = reply.ok && !reply.notice ? (channelIds ?? []) : [];
    deps.events.emit({ type: "game-event", ...event, channelIds: usedChannels });
    return reply;
}

async function handleLinkConfirmed(deps: ClusterRequestHandlerDeps, link: ConfirmedLinkReply): Promise<RouterReply> {
    const updated = await deps.updateLinkReply(link);
    try {
        await deps.onLinkConfirmed?.(link);
    } catch (error) {
        logger.error(logModules.Bot, `Guild ${link.guildId}: follow-up of a confirmed link failed`, error);
    }
    deps.events.emit({
        type: "link-changed",
        guildId: link.guildId,
        discordId: link.discordId,
        change: "linked",
        accountName: link.accountName,
    });
    return updated ? { ok: true } : { ok: false, error: "could not update the link reply" };
}

/** Serves the requests the gateway routes to the cluster that owns a guild. */
export function createClusterRequestHandler(deps: ClusterRequestHandlerDeps): (data: unknown) => Promise<RouterReply> {
    return async (data) => {
        if (!deps.isReady()) return { ok: false, error: "cluster starting" };
        const req = parseClusterRequest(data);
        if (!req) {
            logger.warn(logModules.Bot, "Ignored an invalid request from the gateway");
            return { ok: false, error: "invalid request" };
        }
        switch (req.kind) {
            case "game-event":
                return handleGameEvent(deps, req);
            case "session-started": {
                const { kind: _kind, ...started } = req;
                deps.events.emit({ type: "session-started", ...started });
                return { ok: true };
            }
            case "session-ended":
                await deps.mute.endSession(req.guildId, req.sessionId);
                await restoreNicknames(deps, req.guildId);
                deps.events.emit({ type: "session-ended", guildId: req.guildId, sessionId: req.sessionId });
                return { ok: true };
            case "game-ended": {
                const { kind: _kind, ...ended } = req;
                deps.events.emit({ type: "game-ended", ...ended });
                return { ok: true };
            }
            case "link-confirmed": {
                const { kind: _kind, ...link } = req;
                return handleLinkConfirmed(deps, link);
            }
        }
    };
}
