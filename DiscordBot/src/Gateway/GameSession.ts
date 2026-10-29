import { randomUUID } from "node:crypto";

export interface GameSession {
    sessionId: string;
    guildId: string;
    connectedAt: number;
    pluginVersion: string;
    gameVersion: string;
    protocolVersion: number;
}

export function createGameSession(
    guildId: string,
    pluginVersion: string,
    gameVersion: string,
    protocolVersion: number,
    sessionId: string = randomUUID(),
): GameSession {
    return { sessionId, guildId, connectedAt: Date.now(), pluginVersion, gameVersion, protocolVersion };
}
