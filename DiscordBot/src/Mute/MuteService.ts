import type { LinkRepository } from "../Data/repositories/LinkRepository";
import type { MuteLedgerRepository } from "../Data/repositories/MuteLedgerRepository";
import { logger, logModules } from "../Logging/logger";
import type { ClusterRequest, RouterReply } from "../Routing/messages";
import { computeDesiredState, type DesiredState } from "./desiredState";
import type { VoiceTarget } from "./VoiceTarget";

export interface VoiceMember {
    discordId: string;
    serverMuted: boolean;
}

export interface VoiceAdapter {
    membersInChannel(guildId: string, channelId: string): Promise<VoiceMember[]>;
    /** Resolves to null when the member is not in any voice channel of the guild. */
    findVoiceMember(guildId: string, discordId: string): Promise<VoiceMember | null>;
    setServerMute(guildId: string, discordId: string, mute: boolean): Promise<void>;
}

export interface MuteServiceDeps {
    voice: VoiceAdapter;
    links: LinkRepository;
    ledger: MuteLedgerRepository;
    resolveTarget: (guildId: string, hostAccountName: string) => Promise<VoiceTarget>;
}

export type GameEventRequest = Extract<ClusterRequest, { kind: "game-event" }>;

export class MuteService {
    private readonly queues = new Map<string, Promise<void>>();
    private readonly activeSessions = new Map<string, string>();

    constructor(private readonly deps: MuteServiceDeps) {}

    handleGameEvent(req: GameEventRequest): Promise<RouterReply> {
        return this.enqueue(req.guildId, async () => {
            try {
                return await this.applyGameEvent(req);
            } catch (err) {
                logger.error(logModules.Mute, `Game event ${req.event} failed in guild ${req.guildId}`, err);
                return { ok: false, error: "mute update failed" };
            }
        });
    }

    endSession(guildId: string, sessionId: string): Promise<void> {
        return this.enqueue(guildId, async () => {
            const active = this.activeSessions.get(guildId);
            if (active !== undefined && active !== sessionId) return;
            this.activeSessions.delete(guildId);
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
                if (!(await this.deps.ledger.has(guildId, discordId))) return;
                const member = await this.deps.voice.findVoiceMember(guildId, discordId);
                if (member) await this.unmute(guildId, member);
            });
        });
    }

    private enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.queues.get(guildId) ?? Promise.resolve();
        const run = previous.then(task);
        const tail = run.then(
            () => {},
            () => {},
        );
        this.queues.set(guildId, tail);
        void tail.then(() => {
            if (this.queues.get(guildId) === tail) this.queues.delete(guildId);
        });
        return run;
    }

    private async applyGameEvent(req: GameEventRequest): Promise<RouterReply> {
        if (req.event === "lobby") {
            this.activeSessions.delete(req.guildId);
            await this.releaseGuild(req.guildId);
            return { ok: true };
        }
        this.activeSessions.set(req.guildId, req.sessionId);

        const target = await this.deps.resolveTarget(req.guildId, req.hostAccountName);
        if ("notice" in target) return { ok: true, notice: target.notice };

        const state = computeDesiredState({
            event: req.event,
            players: req.players,
            deadPlayers: req.deadPlayers,
            links: await this.deps.links.listByGuild(req.guildId),
        });
        if (state.ambiguousNames.length > 0) {
            logger.warn(
                logModules.Mute,
                `Guild ${req.guildId}: ${state.ambiguousNames.length} player name(s) match several links and were skipped`,
            );
        }
        await this.applyState(req.guildId, target.channelIds, state);
        return { ok: true };
    }

    private async applyState(guildId: string, channelIds: string[], state: DesiredState): Promise<void> {
        const members = await this.membersInChannels(guildId, channelIds);
        const ledger = new Set((await this.deps.ledger.listByGuild(guildId)).map((e) => e.discordId));

        await Promise.all(
            members.map((member) =>
                this.guarded(guildId, member.discordId, async () => {
                    if (state.muted.has(member.discordId)) {
                        if (!member.serverMuted) await this.mute(guildId, member.discordId);
                    } else if (state.unmuted.has(member.discordId) && ledger.has(member.discordId)) {
                        await this.unmute(guildId, member);
                    }
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

    /** The ledger row comes first so a crash mid-call can never leave an untracked mute. */
    private async mute(guildId: string, discordId: string): Promise<void> {
        await this.deps.ledger.add(guildId, discordId);
        try {
            await this.deps.voice.setServerMute(guildId, discordId, true);
        } catch (err) {
            // Even if the call may have gone through, dropping the row means we never lift a later moderator mute.
            await this.deps.ledger.remove(guildId, discordId).catch((removeErr: unknown) => {
                logger.error(
                    logModules.Mute,
                    `Guild ${guildId}, member ${discordId}: could not drop the ledger row`,
                    removeErr,
                );
            });
            throw err;
        }
    }

    /** Members who left voice stay in the ledger and are unmuted when they rejoin. */
    private async releaseGuild(guildId: string): Promise<void> {
        const entries = await this.deps.ledger.listByGuild(guildId);
        await Promise.all(
            entries.map((entry) =>
                this.guarded(guildId, entry.discordId, async () => {
                    const member = await this.deps.voice.findVoiceMember(guildId, entry.discordId);
                    if (member) await this.unmute(guildId, member);
                }),
            ),
        );
    }

    private async unmute(guildId: string, member: VoiceMember): Promise<void> {
        if (member.serverMuted) await this.deps.voice.setServerMute(guildId, member.discordId, false);
        await this.deps.ledger.remove(guildId, member.discordId);
    }

    private async guarded(guildId: string, discordId: string, action: () => Promise<void>): Promise<void> {
        try {
            await action();
        } catch (err) {
            logger.error(logModules.Mute, `Guild ${guildId}, member ${discordId}: voice update failed`, err);
        }
    }
}
