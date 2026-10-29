import { logger, logModules } from "../Logging/Logger";
import { parseGatewayRequest, type RouterReply } from "../Routing/Messages";
import type { PluginGateway } from "./PluginGateway";

const NOT_CONNECTED: RouterReply = { ok: false, error: "plugin not connected" };

/** Serves the requests clusters send to the gateway; `ok` carries the yes/no answer. */
export function createGatewayRequestHandler(
    plugins: Pick<PluginGateway, "pushLinkPending" | "isConnected">,
): (data: unknown) => RouterReply {
    return (data) => {
        const req = parseGatewayRequest(data);
        if (!req) {
            logger.warn(logModules.WebServer, "Ignored an invalid request from a cluster");
            return { ok: false, error: "invalid request" };
        }
        switch (req.kind) {
            case "push-link-pending":
                return plugins.pushLinkPending(req.guildId, req.phrase, req.quickChatCode, req.discordId)
                    ? { ok: true }
                    : NOT_CONNECTED;
            case "is-plugin-connected":
                return plugins.isConnected(req.guildId) ? { ok: true } : NOT_CONNECTED;
        }
    };
}
