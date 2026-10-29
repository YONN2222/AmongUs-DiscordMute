import { CLOSE_BLOCKED, CLOSE_BOT_LEFT } from "../Protocol/PluginProtocol";
import type { GuildLeaveReason } from "../Routing/Messages";

/** Close code and reason the plugins of a guild receive when the bot leaves it; the reason allows 123 bytes. */
export const LEAVE_DISCONNECTS = {
    "guild-blocked": { code: CLOSE_BLOCKED, reason: "Server blocked" },
    "owner-blocked": { code: CLOSE_BLOCKED, reason: "Server owner blocked" },
    admin: { code: CLOSE_BOT_LEFT, reason: "The bot left this server" },
} as const satisfies Record<GuildLeaveReason, { code: number; reason: string }>;
