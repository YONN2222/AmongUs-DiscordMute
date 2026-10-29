import type { GameEventName } from "../Protocol/PluginProtocol";
import type { GuildSettings } from "../Settings/GuildSettings";

export type Phase = "lobby" | "tasks" | "meeting";

export type VoiceRules = GuildSettings["voiceRules"];

export function phaseOf(event: GameEventName): Phase {
    if (event === "lobby") return "lobby";
    if (event === "meeting-start") return "meeting";
    return "tasks";
}

/** Ghost chat replaces the task rule: the living cannot hear the dead, who may talk freely among themselves. */
export function effectiveRules(settings: GuildSettings): VoiceRules {
    if (!settings.ghostChat) return settings.voiceRules;
    return { ...settings.voiceRules, tasks: { alive: "deafen", dead: "free" } };
}

/** How long the bot waits before it applies the event; a death is never delayed. */
export function delayFor(event: GameEventName, settings: GuildSettings): number {
    switch (event) {
        case "game-start":
            return settings.delaysMs.gameStart;
        case "meeting-start":
            return settings.delaysMs.meetingStart;
        case "meeting-end":
            return settings.delaysMs.meetingEnd;
        case "lobby":
            return settings.delaysMs.lobby;
        case "player-died":
            return 0;
    }
}
