import { logger, logModules } from "../Logging/Logger";
import type { VoiceStatePatch } from "./MuteService";

export interface VoiceChange {
    discordId: string;
    patch: VoiceStatePatch;
}

function isAdd(patch: VoiceStatePatch): boolean {
    return patch.mute === true || patch.deaf === true;
}

function isLift(patch: VoiceStatePatch): boolean {
    return !isAdd(patch) && (patch.mute === false || patch.deaf === false);
}

/** For background work (recovery, sweeps, rejoins), which runs often and mostly changes nothing. */
export function logVoiceChangesIfAny(guildId: string, cause: string, changes: VoiceChange[]): void {
    if (changes.some((change) => isAdd(change.patch) || isLift(change.patch))) logVoiceChanges(guildId, cause, changes);
}

/** One info line per batch of voice changes in a guild; the member ids only go to debug. */
export function logVoiceChanges(guildId: string, cause: string, changes: VoiceChange[]): void {
    const muted = changes.filter((change) => isAdd(change.patch)).map((change) => change.discordId);
    const unmuted = changes.filter((change) => isLift(change.patch)).map((change) => change.discordId);
    logger.info(logModules.Mute, `Guild ${guildId}: ${cause}, muted ${muted.length}, unmuted ${unmuted.length}`);
    if (muted.length + unmuted.length === 0) return;
    logger.debug(
        logModules.Mute,
        `Guild ${guildId}: ${cause}, muted [${muted.join(", ")}], unmuted [${unmuted.join(", ")}]`,
    );
}
