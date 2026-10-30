import type { GatewayLink } from "../Routing/ClusterRouter";
import type { GatewayRequest } from "../Routing/Messages";

type DisconnectRequest = Extract<GatewayRequest, { kind: "disconnect-guild" }>;

/** Asks the gateway to close the plugin connections of a guild; resolves to false when none was open. */
export function createGuildDisconnect(
    gateway: GatewayLink,
): (guildId: string, code: DisconnectRequest["code"], reason: string) => Promise<boolean> {
    return async (guildId, code, reason) =>
        (await gateway.send({ kind: "disconnect-guild", guildId, code, reason })).ok;
}
