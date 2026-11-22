import { randomUUID } from "node:crypto";
import type { Platform } from "../Protocol/PluginProtocol";

export interface GameSession {
    sessionId: string;
    guildId: string;
    connectedAt: number;
    pluginVersion: string;
    gameVersion: string;
    protocolVersion: number;
    /** Unset for plugins that do not report it. */
    platform?: Platform;
}

export function createGameSession(
    guildId: string,
    pluginVersion: string,
    gameVersion: string,
    protocolVersion: number,
    sessionId: string = randomUUID(),
    platform?: Platform,
): GameSession {
    return {
        sessionId,
        guildId,
        connectedAt: Date.now(),
        pluginVersion,
        gameVersion,
        protocolVersion,
        ...(platform ? { platform } : {}),
    };
}
