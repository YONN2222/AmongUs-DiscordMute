import type { LinkRepository } from "../Data/repositories/LinkRepository";
import type { LedgerFlags, MuteLedgerEntry, MuteLedgerRepository } from "../Data/repositories/MuteLedgerRepository";
import type { GuildEventBus } from "../Events/GuildEvents";
import { logger, logModules } from "../Logging/logger";
import type { ClusterRequest, RouterReply } from "../Routing/messages";
import type { VoiceAction } from "../Settings/GuildSettings";
import type { SettingsService } from "../Settings/SettingsService";
import { GuildQueue } from "../Util/GuildQueue";
import { computeDesiredState, type DesiredState } from "./desiredState";
import type { VoiceTarget } from "./VoiceTarget";
import { delayFor, effectiveRules, type Phase, phaseOf } from "./voiceRules";

export interface VoiceMember {
    discordId: string;
    serverMuted: boolean;
    serverDeafened: boolean;
    isBot: boolean;
}

export interface VoiceStatePatch {
    mute?: boolean;
    deaf?: boolean;
}

export interface VoiceAdapter {
    membersInChannel(guildId: string, channelId: string): Promise<VoiceMember[]>;
    /** Resolves to null when the member is not in any voice channel of the guild. */
    findVoiceMember(guildId: string, discordId: string): Promise<VoiceMember | null>;
    /** Changes the server mute and/or deafen of a member with a single call. */
    setVoiceState(guildId: string, discordId: string, patch: VoiceStatePatch): Promise<void>;
}

export interface MuteServiceDeps {
    voice: VoiceAdapter;
    links: LinkRepository;
    ledger: MuteLedgerRepository;
    resolveTarget: (guildId: string, hostAccountName: string) => Promise<VoiceTarget>;
    settings: Pick<SettingsService, "get">;
    events?: Pick<GuildEventBus, "emit">;
    sleep?: (ms: number) => Promise<void>;
}

export type GameEventRequest = Extract<ClusterRequest, { kind: "game-event" }>;

export type GameEventReply = RouterReply & { channelIds?: string[] };

interface WantedFlags {
    mute: boolean;
    deaf: boolean;
}

const DISCORD_MISSING_PERMISSIONS = 50013;
const RELEASE: WantedFlags = { mute: false, deaf: false };

/** A server deafen implies a server mute, so the living cannot talk while they cannot hear. */
function wantedFlags(action: VoiceAction): WantedFlags {
    return { mute: action !== "free", deaf: action === "deafen" };
}

function sameFlags(a: LedgerFlags, b: LedgerFlags): boolean {
    return a.muted === b.muted && a.deafened === b.deafened;
}

function isMissingPermission(err: unknown): boolean {
    return typeof err === "object" && err !== null && "code" in err && err.code === DISCORD_MISSING_PERMISSIONS;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An event that has to wait before it is applied; it takes its place in the queue again once the wait is over. */
class DelayedEvent {
    constructor(
        readonly ms: number,
        readonly pending: PendingDelay,
        readonly channelIds?: string[],
    ) {}
}

interface PendingDelay {
    sessionId: string;
    cancelled: boolean;
}

export class MuteService {
    private readonly queue = new GuildQueue();
    private readonly activeSessions = new Map<string, string>();
    /** Counts the events of a guild in arrival order; a delayed event that was overtaken is dropped. */
    private readonly sequence = new Map<string, number>();
    private readonly pendingDelays = new Map<string, Set<PendingDelay>>();
    /** The phase last applied per guild; a death keeps a running meeting a meeting. */
    private readonly phases = new Map<string, Phase>();
    /** The player lists of the latest death, so a delayed phase change does not revive the dead. */
    private readonly latestDeath = new Map<string, Pick<GameEventRequest, "sessionId" | "players" | "deadPlayers">>();
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(private readonly deps: MuteServiceDeps) {
        this.sleep = deps.sleep ?? defaultSleep;
    }

    async handleGameEvent(req: GameEventRequest): Promise<GameEventReply> {
        const { guildId } = req;
        // A death does not change the phase, so it must not supersede a delayed phase change.
        const isDeath = req.event === "player-died";
        const seq = isDeath ? (this.sequence.get(guildId) ?? 0) : this.nextSequence(guildId);
        if (isDeath) {
            const { sessionId, players, deadPlayers } = req;
            this.latestDeath.set(guildId, { sessionId, players, deadPlayers });
        } else {
            this.latestDeath.delete(guildId);
        }
        // The first pass sits in the queue so events keep their arrival order, but it never sleeps there.
        const first = await this.enqueue(guildId, async () => {
            const delayMs = await this.delayOf(req);
            return delayMs > 0 ? this.acceptDelayed(req, delayMs) : this.applySafely(req);
        });
        if (!(first instanceof DelayedEvent)) return first;

        // The request is answered now so a long delay never runs into the gateway's request timeout.
        this.applyLater(req, seq, first);
        return first.channelIds ? { ok: true, channelIds: first.channelIds } : { ok: true };
    }

    /** Resolves the target up front so the host still gets the notice or the channels in the reply. */
    private async acceptDelayed(req: GameEventRequest, delayMs: number): Promise<GameEventReply | DelayedEvent> {
        if (req.event === "lobby") return new DelayedEvent(delayMs, this.registerDelay(req));
        try {
            const target = await this.deps.resolveTarget(req.guildId, req.hostAccountName);
            if ("notice" in target) return { ok: true, notice: target.notice };
            return new DelayedEvent(delayMs, this.registerDelay(req), target.channelIds);
        } catch (err) {
            logger.error(logModules.Mute, `Game event ${req.event} failed in guild ${req.guildId}`, err);
            return { ok: false, error: "mute update failed" };
        }
    }

    /** Registered inside the queue, so an endSession queued behind the event always sees it. */
    private registerDelay(req: GameEventRequest): PendingDelay {
        const pending: PendingDelay = { sessionId: req.sessionId, cancelled: false };
        const set = this.pendingDelays.get(req.guildId) ?? new Set<PendingDelay>();
        set.add(pending);
        this.pendingDelays.set(req.guildId, set);
        return pending;
    }

    private applyLater(req: GameEventRequest, seq: number, { ms, pending }: DelayedEvent): void {
        const { guildId } = req;
        const set = this.pendingDelays.get(guildId);
        void this.sleep(ms)
            .then(() =>
                this.enqueue(guildId, async () => {
                    if (pending.cancelled || this.sequence.get(guildId) !== seq) {
                        logger.debug(
                            logModules.Mute,
                            `Guild ${guildId}: dropped delayed ${req.event}, it was replaced or its session ended`,
                        );
                        return;
                    }
                    const death = this.latestDeath.get(guildId);
                    await this.applySafely(death?.sessionId === req.sessionId ? { ...req, ...death } : req);
                }),
            )
            .catch((err: unknown) => {
                logger.error(logModules.Mute, `Delayed ${req.event} failed in guild ${guildId}`, err);
            })
            .finally(() => {
                set?.delete(pending);
                if (set?.size === 0 && this.pendingDelays.get(guildId) === set) this.pendingDelays.delete(guildId);
            });
    }

    endSession(guildId: string, sessionId: string): Promise<void> {
        return this.enqueue(guildId, async () => {
            const active = this.activeSessions.get(guildId);
            if (active !== undefined && active !== sessionId) return;
            this.activeSessions.delete(guildId);
            this.phases.delete(guildId);
            this.latestDeath.delete(guildId);
            // Only events still waiting out their delay that belong to the session that just ended are dropped.
            for (const pending of this.pendingDelays.get(guildId) ?? []) {
                if (pending.sessionId === sessionId) pending.cancelled = true;
            }
            try {
                await this.releaseGuild(guildId);
            } catch (err) {
                logger.error(logModules.Mute, `Could not end the session in guild ${guildId}`, err);
            }
        });
    }

    /** Runs once on cluster ready so mutes left behind by a crash are lifted. */
    async recover(guildIds: string[]): Promise<void> {
        await Promise.all(
            guildIds.map((guildId) =>
                this.enqueue(guildId, async () => {
                    try {
                        await this.releaseGuild(guildId);
                    } catch (err) {
                        logger.error(logModules.Mute, `Could not recover mutes in guild ${guildId}`, err);
                    }
                }),
            ),
        );
    }

    /** Lifts a mute left behind for a member who rejoins voice once no session is running. */
    releaseIfIdle(guildId: string, discordId: string): Promise<void> {
        return this.enqueue(guildId, async () => {
            if (this.activeSessions.has(guildId)) return;
            await this.guarded(guildId, discordId, async () => {
                const entry = await this.deps.ledger.get(guildId, discordId);
                if (!entry) return;
                const member = await this.deps.voice.findVoiceMember(guildId, discordId);
                if (member) await this.reconcile(guildId, member, RELEASE, entry);
            });
        });
    }

    /** Periodic retry for guilds without a running session that still have mutes on record. */
    async sweepIdle(guildIds: string[]): Promise<void> {
        if (guildIds.length === 0) return;
        const withEntries = new Set((await this.deps.ledger.listByGuilds(guildIds)).map((entry) => entry.guildId));
        await Promise.all(
            [...withEntries].map((guildId) =>
                this.enqueue(guildId, async () => {
                    if (this.activeSessions.has(guildId)) return;
                    try {
                        await this.releaseGuild(guildId);
                    } catch (err) {
                        logger.error(logModules.Mute, `Could not sweep mutes in guild ${guildId}`, err);
                    }
                }),
            ),
        );
    }

    private enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
        return this.queue.run(guildId, task);
    }

    private nextSequence(guildId: string): number {
        const next = (this.sequence.get(guildId) ?? 0) + 1;
        this.sequence.set(guildId, next);
        return next;
    }

    private async delayOf(req: GameEventRequest): Promise<number> {
        try {
            return delayFor(req.event, await this.deps.settings.get(req.guildId));
        } catch {
            return 0;
        }
    }

    private async applySafely(req: GameEventRequest): Promise<GameEventReply> {
        try {
            return await this.applyGameEvent(req);
        } catch (err) {
            logger.error(logModules.Mute, `Game event ${req.event} failed in guild ${req.guildId}`, err);
            return { ok: false, error: "mute update failed" };
        }
    }

    private async applyGameEvent(req: GameEventRequest): Promise<GameEventReply> {
        if (req.event === "lobby") {
            this.activeSessions.delete(req.guildId);
            this.phases.delete(req.guildId);
            await this.releaseGuild(req.guildId);
            return { ok: true };
        }
        this.activeSessions.set(req.guildId, req.sessionId);
        const event =
            req.event === "player-died" && this.phases.get(req.guildId) === "meeting" ? "meeting-start" : req.event;
        if (req.event !== "player-died") this.phases.set(req.guildId, phaseOf(req.event));

        const target = await this.deps.resolveTarget(req.guildId, req.hostAccountName);
        if ("notice" in target) return { ok: true, notice: target.notice };

        const settings = await this.deps.settings.get(req.guildId);
        const state = computeDesiredState({
            event,
            players: req.players,
            deadPlayers: req.deadPlayers,
            links: await this.deps.links.listByGuild(req.guildId),
            rules: effectiveRules(settings),
            nonPlayers: settings.nonPlayers,
        });
        if (state.ambiguousNames.length > 0) {
            logger.warn(
                logModules.Mute,
                `Guild ${req.guildId}: ${state.ambiguousNames.length} player name(s) match several links and were skipped`,
            );
        }
        await this.applyState(req.guildId, target.channelIds, state);
        return { ok: true, channelIds: target.channelIds };
    }

    private async applyState(guildId: string, channelIds: string[], state: DesiredState): Promise<void> {
        const members = await this.membersInChannels(guildId, channelIds);
        const ledger = new Map((await this.deps.ledger.listByGuild(guildId)).map((entry) => [entry.discordId, entry]));

        await Promise.all(
            members.map((member) =>
                this.guarded(guildId, member.discordId, async () => {
                    if (member.isBot) return;
                    const action = state.actions.get(member.discordId) ?? state.nonPlayerAction;
                    if (action === null) return;
                    await this.reconcile(guildId, member, wantedFlags(action), ledger.get(member.discordId));
                }),
            ),
        );
    }

    private async membersInChannels(guildId: string, channelIds: string[]): Promise<VoiceMember[]> {
        const members = new Map<string, VoiceMember>();
        for (const channelId of channelIds) {
            try {
                for (const member of await this.deps.voice.membersInChannel(guildId, channelId)) {
                    members.set(member.discordId, member);
                }
            } catch (err) {
                logger.error(logModules.Mute, `Guild ${guildId}, channel ${channelId}: could not list members`, err);
            }
        }
        return [...members.values()];
    }

    /**
     * Brings one member to the wanted mute and deafen state with a single Discord call. A flag is only ever
     * lifted when the ledger says the bot set it, and a newly set flag is written to the ledger first so a
     * crash mid-call can never leave an untracked mute.
     */
    private async reconcile(
        guildId: string,
        member: VoiceMember,
        want: WantedFlags,
        entry: MuteLedgerEntry | undefined,
    ): Promise<void> {
        const prev: LedgerFlags = { muted: entry?.muted ?? false, deafened: entry?.deafened ?? false };
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

        if (!sameFlags(prev, withAdds)) await this.deps.ledger.set(guildId, member.discordId, withAdds);
        if (patch.mute !== undefined || patch.deaf !== undefined) {
            try {
                await this.deps.voice.setVoiceState(guildId, member.discordId, patch);
            } catch (err) {
                // Even if the call may have gone through, dropping the new flags means we never lift a later moderator change.
                if (!sameFlags(prev, withAdds)) {
                    await this.deps.ledger.set(guildId, member.discordId, prev).catch((revertErr: unknown) => {
                        logger.error(
                            logModules.Mute,
                            `Guild ${guildId}, member ${member.discordId}: could not restore the ledger`,
                            revertErr,
                        );
                    });
                }
                throw err;
            }
        }
        if (!sameFlags(withAdds, final)) await this.deps.ledger.set(guildId, member.discordId, final);
    }

    /** Members who left voice stay in the ledger and are released when they rejoin. */
    private async releaseGuild(guildId: string): Promise<void> {
        const entries = await this.deps.ledger.listByGuild(guildId);
        await Promise.all(
            entries.map((entry) =>
                this.guarded(guildId, entry.discordId, async () => {
                    const member = await this.deps.voice.findVoiceMember(guildId, entry.discordId);
                    if (member) await this.reconcile(guildId, member, RELEASE, entry);
                }),
            ),
        );
    }

    private async guarded(guildId: string, discordId: string, action: () => Promise<void>): Promise<void> {
        try {
            await action();
        } catch (err) {
            logger.error(logModules.Mute, `Guild ${guildId}, member ${discordId}: voice update failed`, err);
            if (isMissingPermission(err)) {
                this.deps.events?.emit({ type: "voice-error", guildId, code: "missing-permission", discordId });
            }
        }
    }
}
