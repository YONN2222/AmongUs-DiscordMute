import type { LedgerFlags, MuteLedgerEntry, MuteLedgerRepository } from "../Data/Repositories/MuteLedgerRepository";
import { logger, logModules } from "../Logging/Logger";
import type { VoiceAction } from "../Settings/GuildSettings";
import type { VoiceAdapter, VoiceMember, VoiceStatePatch } from "./MuteService";

export interface WantedFlags {
    mute: boolean;
    deaf: boolean;
}

export const RELEASE: WantedFlags = { mute: false, deaf: false };

/** A server deafen implies a server mute, so the living cannot talk while they cannot hear. */
export function wantedFlags(action: VoiceAction): WantedFlags {
    return { mute: action !== "free", deaf: action === "deafen" };
}

function sameFlags(a: LedgerFlags, b: LedgerFlags): boolean {
    return a.muted === b.muted && a.deafened === b.deafened;
}

export interface ReconcileDeps {
    ledger: Pick<MuteLedgerRepository, "set">;
    voice: Pick<VoiceAdapter, "setVoiceState">;
}

/**
 * Brings one member to the wanted mute and deafen state with a single Discord call. A flag is only ever
 * lifted when the ledger says the bot set it, and a newly set flag is written to the ledger first so a
 * crash mid-call can never leave an untracked mute. The row is recorded for `sessionId`, so the session that
 * touched the member last owns the row, even when only the owner changes.
 */
export async function reconcileMember(
    deps: ReconcileDeps,
    guildId: string,
    member: VoiceMember,
    want: WantedFlags,
    entry: MuteLedgerEntry | undefined,
    sessionId: string | null,
): Promise<void> {
    const prev: LedgerFlags = { muted: entry?.muted ?? false, deafened: entry?.deafened ?? false };
    const prevOwner = entry?.sessionId ?? null;
    const addMute = want.mute && !member.serverMuted;
    const addDeaf = want.deaf && !member.serverDeafened;
    const liftMute = !want.mute && prev.muted;
    const liftDeaf = !want.deaf && prev.deafened;

    const patch: VoiceStatePatch = {};
    if (addMute) patch.mute = true;
    else if (liftMute && member.serverMuted) patch.mute = false;
    if (addDeaf) patch.deaf = true;
    else if (liftDeaf && member.serverDeafened) patch.deaf = false;

    const withAdds: LedgerFlags = { muted: prev.muted || addMute, deafened: prev.deafened || addDeaf };
    const final: LedgerFlags = { muted: withAdds.muted && !liftMute, deafened: withAdds.deafened && !liftDeaf };
    const changesOwner = entry !== undefined && prevOwner !== sessionId;
    const writesFirst = !sameFlags(prev, withAdds) || changesOwner;

    if (writesFirst) await deps.ledger.set(guildId, member.discordId, withAdds, sessionId);
    if (patch.mute !== undefined || patch.deaf !== undefined) {
        try {
            await deps.voice.setVoiceState(guildId, member.discordId, patch);
        } catch (err) {
            // Even if the call may have gone through, dropping the new flags means we never lift a later moderator change.
            if (writesFirst) await restoreLedger(deps, guildId, member.discordId, prev, prevOwner);
            throw err;
        }
    }
    if (!sameFlags(withAdds, final)) await deps.ledger.set(guildId, member.discordId, final, sessionId);
}

/** Never rejects, so the error of the failed voice call is the one that gets reported. */
async function restoreLedger(
    deps: ReconcileDeps,
    guildId: string,
    discordId: string,
    flags: LedgerFlags,
    sessionId: string | null,
): Promise<void> {
    try {
        await deps.ledger.set(guildId, discordId, flags, sessionId);
    } catch (err) {
        logger.error(logModules.Mute, `Guild ${guildId}, member ${discordId}: could not restore the ledger`, err);
    }
}
