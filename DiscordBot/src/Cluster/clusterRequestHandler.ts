import { logger, logModules } from "../Logging/logger";
import type { MuteService } from "../Mute/MuteService";
import { type ClusterRequest, parseClusterRequest, type RouterReply } from "../Routing/messages";

export type ConfirmedLinkReply = Omit<Extract<ClusterRequest, { kind: "link-confirmed" }>, "kind">;

export interface ClusterRequestHandlerDeps {
    mute: Pick<MuteService, "handleGameEvent" | "endSession">;
    /** Resolves to false when the original /link reply could not be updated. */
    updateLinkReply: (link: ConfirmedLinkReply) => Promise<boolean>;
    /** False until startup recovery ran, so recovery can never undo a mute applied before it. */
    isReady: () => boolean;
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
                return deps.mute.handleGameEvent(req);
            case "session-ended":
                await deps.mute.endSession(req.guildId, req.sessionId);
                return { ok: true };
            case "link-confirmed": {
                const { kind: _kind, ...link } = req;
                return (await deps.updateLinkReply(link))
                    ? { ok: true }
                    : { ok: false, error: "could not update the link reply" };
            }
        }
    };
}
