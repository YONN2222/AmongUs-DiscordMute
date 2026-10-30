import { type ClusterInfoReply, isClusterInfoRequest } from "../Admin/ClusterInfo";
import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import type { GuildEventBus } from "../Events/GuildEvents";
import { relinkFromRoster } from "../Game/AutoRelink";
import type { NicknameSync } from "../Game/NicknameSync";
import type { GuildLifecycle } from "../Hosted/GuildLifecycle";
import { logger, logModules } from "../Logging/Logger";
import { isMetricsSnapshotRequest, type MetricsSnapshotReply } from "../Metrics/SnapshotMessages";
import type { MuteService } from "../Mute/MuteService";
import { type ClusterRequest, parseClusterRequest, type RouterReply } from "../Routing/Messages";
import type { SettingsService } from "../Settings/SettingsService";

export type ConfirmedLinkReply = Omit<Extract<ClusterRequest, { kind: "link-confirmed" }>, "kind">;

type GameEventRequest = Extract<ClusterRequest, { kind: "game-event" }>;

const GAME_REQUEST_KINDS = new Set<ClusterRequest["kind"]>([
    "game-event",
    "session-started",
    "session-ended",
    "game-ended",
]);

export interface ClusterRequestHandlerDeps {
    mute: Pick<MuteService, "handleGameEvent" | "endSession" | "hasEnded" | "isRemoved">;
    /** Resolves to false when the original /link reply could not be updated. */
    updateLinkReply: (link: ConfirmedLinkReply) => Promise<boolean>;
    /** False until startup recovery ran, so recovery can never undo a mute applied before it. */
    isReady: () => boolean;
    events: Pick<GuildEventBus, "emit">;
    links: LinkRepository;
    settings: Pick<SettingsService, "get">;
    nicknames?: Pick<NicknameSync, "restoreSession">;
    onLinkConfirmed?: (link: ConfirmedLinkReply) => Promise<void>;
    /** Set only in hosted mode. */
    lifecycle?: Pick<GuildLifecycle, "leave">;
    /** Guilds, ping, shards and resources of this cluster, for the admin API. */
    clusterInfo: () => ClusterInfoReply;
    /** This cluster's metrics, for the gateway's metrics endpoint. */
    metricsSnapshot: () => Promise<MetricsSnapshotReply>;
}

export type ClusterReply = RouterReply | ClusterInfoReply | MetricsSnapshotReply;

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
async function restoreNicknames(deps: ClusterRequestHandlerDeps, guildId: string, sessionId: string): Promise<void> {
    try {
        await deps.nicknames?.restoreSession(guildId, sessionId);
    } catch (error) {
        logger.error(logModules.Bot, `Guild ${guildId}: restoring nicknames failed`, error);
    }
}

async function handleGameEvent(deps: ClusterRequestHandlerDeps, req: GameEventRequest): Promise<RouterReply> {
    await relinkSafely(deps, req);
    // session-ended can overtake this event while it relinks; an ended game must not mute, rename or post again.
    if (deps.mute.hasEnded(req.sessionId)) return { ok: true };
    const { channelIds, ...reply } = await deps.mute.handleGameEvent(req);
    // The gateway stops waiting after a while, so session-ended can also overtake a slow mute call.
    if (deps.mute.hasEnded(req.sessionId)) return reply;
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

async function handleLeaveGuild(
    deps: ClusterRequestHandlerDeps,
    req: Extract<ClusterRequest, { kind: "leave-guild" }>,
): Promise<RouterReply> {
    if (!deps.lifecycle) return { ok: false, error: "not hosted" };
    return (await deps.lifecycle.leave(req.guildId)) ? { ok: true } : { ok: false, error: "not-in-guild" };
}

/** Answers every request the gateway sends to this cluster: cluster-wide queries and guild requests. */
export function createClusterRequestHandler(deps: ClusterRequestHandlerDeps): (data: unknown) => Promise<ClusterReply> {
    return async (data) => {
        // The gateway asks every cluster for these, also while it is still starting.
        if (isClusterInfoRequest(data)) return deps.clusterInfo();
        if (isMetricsSnapshotRequest(data)) return deps.metricsSnapshot();
        if (!deps.isReady()) return { ok: false, error: "cluster starting" };
        const req = parseClusterRequest(data);
        if (!req) {
            logger.warn(logModules.Bot, "Ignored an invalid request from the gateway");
            return { ok: false, error: "invalid request" };
        }
        // A guild that removed the bot gets no Discord calls; its ledger is lifted once the bot is added back.
        if (GAME_REQUEST_KINDS.has(req.kind) && deps.mute.isRemoved(req.guildId)) return { ok: true };
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
                await restoreNicknames(deps, req.guildId, req.sessionId);
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
            case "leave-guild":
                return handleLeaveGuild(deps, req);
        }
    };
}
