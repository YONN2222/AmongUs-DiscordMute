import type { GatewayNotice } from "../Protocol/PluginProtocol";

/** The voice channels a game event applies to, or a notice explaining why there are none. */
export type VoiceTarget = { channelIds: string[] } | { notice: GatewayNotice };
