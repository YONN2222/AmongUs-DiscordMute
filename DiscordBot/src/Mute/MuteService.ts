import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import type { MuteLedgerEntry, MuteLedgerRepository } from "../Data/Repositories/MuteLedgerRepository";
import type { GuildEventBus } from "../Events/GuildEvents";
import { logger, logModules } from "../Logging/Logger";
import type { ClusterRequest, RouterReply } from "../Routing/Messages";
import type { SettingsService } from "../Settings/SettingsService";
import { ActiveSessions } from "../Utils/ActiveSessions";
import { EndedSessions } from "../Utils/EndedSessions";
import { GuildQueue } from "../Utils/GuildQueue";
import { computeDesiredState, type DesiredState } from "./DesiredState";
import { RELEASE, reconcileMember, wantedFlags } from "./ReconcileMember";
import { delayFor, effectiveRules, type Phase, phaseOf } from "./VoiceRules";
import type { VoiceTarget } from "./VoiceTarget";

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

const DISCORD_MISSING_PERMISSIONS = 50013;

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
    guildId: string;
    cancelled: boolean;
}

/**
 * Applies the voice rules of every running game. Several games (sessions) can run in one guild at once; the mute
 * ledger records which session touched a member last, and a session only ever lifts rows no running session owns.
 * Per-session state is keyed by the session id, which the gateway generates and which is unique across guilds.
 */
export class MuteService {
    private readonly queue = new GuildQueue();
    /** The sessions per guild that are in a game; the ledger rows they own stay until they end or reach the lobby. */
    private readonly activeSessions = new ActiveSessions();
    /** A late game event of an ended session must not start it again, or its mutes would stay until restart. */
    private readonly endedSessions = new EndedSessions();
    /** Guilds the bot is leaving; their games are over, so every event of them is dropped until the leave returned. */
    private readonly leavingGuilds = new Set<string>();
    /** Guilds that removed the bot; nothing of them is applied until recover runs for them. */
    private readonly removedGuilds = new Set<string>();
    /** Counts the events of a session in arrival order; a delayed event that was overtaken is dropped. */
    private readonly sequence = new Map<string, number>();
    private readonly pendingDelays = new Map<string, Set<PendingDelay>>();
    /** The phase last applied per session; a death keeps a running meeting a meeting. */
    private readonly phases = new Map<string, Phase>();
    /** The player lists of the latest death per session, so a delayed phase change does not revive the dead. */
    private readonly latestDeath = new Map<string, Pick<GameEventRequest, "players" | "deadPlayers">>();
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(private readonly deps: MuteServiceDeps) {
        this.sleep = deps.sleep ?? defaultSleep;
    }

    async handleGameEvent(req: GameEventRequest): Promise<GameEventReply> {
        const { guildId, sessionId } = req;
        if (this.isDropped(guildId, sessionId)) return { ok: true };
        // A death does not change the phase, so it must not supersede a delayed phase change.
        const isDeath = req.event === "player-died";
        const seq = isDeath ? (this.sequence.get(sessionId) ?? 0) : this.nextSequence(sessionId);
        if (isDeath) {
            this.latestDeath.set(sessionId, { players: req.players, deadPlayers: req.deadPlayers });
        } else {
            this.latestDeath.delete(sessionId);
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
    private registerDelay({ guildId, sessionId }: GameEventRequest): PendingDelay {
        const pending: PendingDelay = { guildId, cancelled: false };
        const set = this.pendingDelays.get(sessionId) ?? new Set<PendingDelay>();
        set.add(pending);
        this.pendingDelays.set(sessionId, set);
        return pending;
    }

    private applyLater(req: GameEventRequest, seq: number, { ms, pending }: DelayedEvent): void {
        const { guildId, sessionId } = req;
        const set = this.pendingDelays.get(sessionId);
        void this.sleep(ms)
            .then(() =>
                this.enqueue(guildId, async () => {
                    if (pending.cancelled || this.sequence.get(sessionId) !== seq) {
                        logger.debug(
                            logModules.Mute,
                            `Guild ${guildId}: dropped delayed ${req.event}, it was replaced or its session ended`,
                        );
                        return;
                    }
                    const death = this.latestDeath.get(sessionId);
                    await this.applySafely(death ? { ...req, ...death } : req);
                }),
            )
            .catch((err: unknown) => {
                logger.error(logModules.Mute, `Delayed ${req.event} failed in guild ${guildId}`, err);
            })
            .finally(() => {
                set?.delete(pending);
                if (set?.size === 0 && this.pendingDelays.get(sessionId) === set) this.pendingDelays.delete(sessionId);
            });
    }

    private isDropped(guildId: string, sessionId: string): boolean {
        return this.hasEnded(sessionId) || this.leavingGuilds.has(guildId) || this.isRemoved(guildId);
    }

    /** True from forgetGuild until recover ran for the guild. */
    isRemoved(guildId: string): boolean {
        return this.removedGuilds.has(guildId);
    }

    /** True once endSession was called for the session, before its release even ran. */
    hasEnded(sessionId: string): boolean {
        return this.endedSessions.has(sessionId);
    }

    endSession(guildId: string, sessionId: string): Promise<void> {
        // Recorded right away, so an event that is still on its way is dropped instead of queued behind the end.
        this.endedSessions.add(sessionId);
        return this.enqueue(guildId, async () => {
            this.forgetSession(sessionId);
            try {
                await this.releaseSession(guildId, sessionId);
            } catch (err) {
                logger.error(logModules.Mute, `Could not end the session in guild ${guildId}`, err);
            }
        });
    }

    /**
     * Ends every game in the guild and lifts every mute on record there; runs before the bot leaves the guild,
     * because it cannot lift them afterwards. Every later event of the guild, including one still waiting out its
     * delay, is dropped until reopenGuild. Rejects when the ledger cannot be read, so the bot stays.
     */
    endGuild(guildId: string): Promise<void> {
        this.leavingGuilds.add(guildId);
        return this.enqueue(guildId, async () => {
            this.endSessionsOf(guildId);
            await this.releaseGuild(guildId);
        });
    }

    /** Called once the leave returned; if the bot is still in the guild, new games work again. */
    reopenGuild(guildId: string): void {
        this.leavingGuilds.delete(guildId);
    }

    /**
     * The guild removed the bot, which therefore cannot lift anything there: ends its games in memory only and keeps
     * every ledger row, so recover can lift them once the bot is added back.
     */
    forgetGuild(guildId: string): void {
        this.removedGuilds.add(guildId);
        this.endSessionsOf(guildId);
    }

    /**
     * Lifts every mute on record in the guilds: once on cluster ready after a crash, and when a guild adds the bot
     * back. Events of a removed guild are applied again only after its mutes were lifted.
     */
    async recover(guildIds: string[]): Promise<void> {
        await Promise.all(
            guildIds.map((guildId) =>
                this.enqueue(guildId, async () => {
                    this.removedGuilds.delete(guildId);
                    try {
                        await this.releaseGuild(guildId);
                    } catch (err) {
                        logger.error(logModules.Mute, `Could not recover mutes in guild ${guildId}`, err);
                    }
                }),
            ),
        );
    }

    /** Lifts a mute left behind for a member who rejoins voice once the session that owns it no longer runs. */
    releaseIfIdle(guildId: string, discordId: string): Promise<void> {
        return this.enqueue(guildId, () =>
            this.guarded(guildId, discordId, async () => {
                const entry = await this.deps.ledger.get(guildId, discordId);
                if (!entry || this.activeSessions.has(guildId, entry.sessionId)) return;
                const member = await this.deps.voice.findVoiceMember(guildId, discordId);
                if (member) await reconcileMember(this.deps, guildId, member, RELEASE, entry, entry.sessionId);
            }),
        );
    }

    /** Periodic retry for mutes on record that no running session owns any more. */
    async sweepIdle(guildIds: string[]): Promise<void> {
        if (guildIds.length === 0) return;
        const withEntries = new Set((await this.deps.ledger.listByGuilds(guildIds)).map((entry) => entry.guildId));
        await Promise.all(
            [...withEntries].map((guildId) =>
                this.enqueue(guildId, async () => {
                    try {
                        await this.releaseUnowned(guildId);
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

    /** Drops the state of the session and cancels its events that still wait out their delay. */
    private forgetSession(sessionId: string): void {
        this.phases.delete(sessionId);
        this.latestDeath.delete(sessionId);
        this.sequence.delete(sessionId);
        for (const pending of this.pendingDelays.get(sessionId) ?? []) pending.cancelled = true;
    }

    /** Ends every game of the guild in memory, including the delays of games still in the lobby; the ledger stays. */
    private endSessionsOf(guildId: string): void {
        for (const sessionId of this.activeSessions.of(guildId)) {
            this.endedSessions.add(sessionId);
            this.forgetSession(sessionId);
            this.activeSessions.delete(guildId, sessionId);
        }
        this.cancelDelaysOf(guildId);
    }

    /** Also cancels the delays of games that are still in the lobby and therefore not active yet. */
    private cancelDelaysOf(guildId: string): void {
        for (const delays of this.pendingDelays.values()) {
            for (const pending of delays) if (pending.guildId === guildId) pending.cancelled = true;
        }
    }

    private nextSequence(sessionId: string): number {
        const next = (this.sequence.get(sessionId) ?? 0) + 1;
        this.sequence.set(sessionId, next);
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
        const { guildId, sessionId } = req;
        if (this.isDropped(guildId, sessionId)) return { ok: true };
        if (req.event === "lobby") {
            this.phases.delete(sessionId);
            await this.releaseSession(guildId, sessionId);
            return { ok: true };
        }
        this.activeSessions.add(guildId, sessionId);
        const event =
            req.event === "player-died" && this.phases.get(sessionId) === "meeting" ? "meeting-start" : req.event;
        if (req.event !== "player-died") this.phases.set(sessionId, phaseOf(req.event));

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
        await this.applyState(req.guildId, sessionId, target.channelIds, state);
        return { ok: true, channelIds: target.channelIds };
    }

    private async applyState(
        guildId: string,
        sessionId: string,
        channelIds: string[],
        state: DesiredState,
    ): Promise<void> {
        const members = await this.membersInChannels(guildId, channelIds);
        const ledger = new Map((await this.deps.ledger.listByGuild(guildId)).map((entry) => [entry.discordId, entry]));

        await Promise.all(
            members.map((member) =>
                this.guarded(guildId, member.discordId, async () => {
                    if (member.isBot) return;
                    const action = state.actions.get(member.discordId) ?? state.nonPlayerAction;
                    if (action === null) return;
                    const entry = ledger.get(member.discordId);
                    await reconcileMember(this.deps, guildId, member, wantedFlags(action), entry, sessionId);
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

    /** Takes the session out of the game and lifts every mute no running session owns, its own included. */
    private async releaseSession(guildId: string, sessionId: string): Promise<void> {
        this.activeSessions.delete(guildId, sessionId);
        await this.releaseUnowned(guildId);
    }

    /** Rows of other running sessions stay; rows without a session or of a session that ended are lifted. */
    private async releaseUnowned(guildId: string): Promise<void> {
        const entries = await this.deps.ledger.listByGuild(guildId);
        await this.releaseEntries(
            guildId,
            entries.filter((entry) => !this.activeSessions.has(guildId, entry.sessionId)),
        );
    }

    /** Lifts every row of the guild, whichever session owns it. */
    private async releaseGuild(guildId: string): Promise<void> {
        await this.releaseEntries(guildId, await this.deps.ledger.listByGuild(guildId));
    }

    /** Members who left voice stay in the ledger and are released when they rejoin. */
    private async releaseEntries(guildId: string, entries: MuteLedgerEntry[]): Promise<void> {
        await Promise.all(
            entries.map((entry) =>
                this.guarded(guildId, entry.discordId, async () => {
                    const member = await this.deps.voice.findVoiceMember(guildId, entry.discordId);
                    if (member) await reconcileMember(this.deps, guildId, member, RELEASE, entry, entry.sessionId);
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
