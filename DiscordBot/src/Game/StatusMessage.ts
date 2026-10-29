import { classifyDiscordError, type MessagePayload, type MessagePort } from "../Cluster/MessagePort";
import { normalizeAccountName } from "../Data/AccountNameMatch";
import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import type { TrackedMessage, TrackedMessageRepository } from "../Data/Repositories/TrackedMessageRepository";
import type { GuildEvent } from "../Events/GuildEvents";
import { logger, logModules } from "../Logging/Logger";
import { type Phase, phaseOf } from "../Mute/VoiceRules";
import type { GameEventName, RosterEntry } from "../Protocol/PluginProtocol";
import type { SettingsService } from "../Settings/SettingsService";
import { createNameResolver } from "./PlayerNames";
import { renderStatus, type StatusPlayer } from "./RenderStatus";
import { isFinalDeleteError } from "./TrackedMessageSweeper";

const KIND = "status";
const DEFAULT_MIN_INTERVAL_MS = 3000;
const WARN_INTERVAL_MS = 10 * 60_000;
/** Deaths become visible only at these events, so the status never gives away who died before a meeting. */
const DEATH_REVEALING_EVENTS = new Set<GameEventName>(["game-start", "meeting-start", "meeting-end"]);

type GameEvent = Extract<GuildEvent, { type: "game-event" }>;
type GameEndedEvent = Extract<GuildEvent, { type: "game-ended" }>;

export interface StatusMessageDeps {
    port: MessagePort;
    tracked: Pick<TrackedMessageRepository, "get" | "upsert" | "remove" | "listByGuilds">;
    links: Pick<LinkRepository, "listByGuild">;
    settings: Pick<SettingsService, "get">;
    minIntervalMs?: number;
    now?: () => number;
}

interface Session {
    guildId: string;
    sessionId: string;
    phase: Phase;
    lobbyCode: string | null;
    hostAccountName: string;
    players: Array<{ name: string; dead: boolean }>;
    chain: Promise<void>;
    timer?: ReturnType<typeof setTimeout>;
    inFlight: number;
    dirty: boolean;
    lastRefreshAt: number;
    lastWarnAt?: number;
    ended: boolean;
}

const sessionKey = (guildId: string, sessionId: string) => `${guildId}:${sessionId}`;
const nameKey = normalizeAccountName;

/** Names with their dead flag from the roster, or from the player lists of a v2 plugin that sends no roster. */
function namesOf(
    roster: RosterEntry[] | undefined,
    players: string[],
    deadPlayers: string[],
): Array<{ name: string; dead: boolean }> {
    if (roster) return roster.map((entry) => ({ name: entry.name, dead: entry.dead }));
    const dead = new Set(deadPlayers.map(nameKey));
    const seen = new Set<string>();
    const result: Array<{ name: string; dead: boolean }> = [];
    for (const name of [...players, ...deadPlayers]) {
        if (seen.has(nameKey(name))) continue;
        seen.add(nameKey(name));
        result.push({ name, dead: dead.has(nameKey(name)) });
    }
    return result;
}

/** One public message per plugin session that shows the lobby code, the phase and who plays. */
export class StatusMessage {
    private readonly sessions = new Map<string, Session>();
    private readonly minIntervalMs: number;
    private readonly now: () => number;

    constructor(private readonly deps: StatusMessageDeps) {
        this.minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
        this.now = deps.now ?? Date.now;
    }

    async handle(event: GuildEvent): Promise<void> {
        switch (event.type) {
            case "game-event":
                // A death stays hidden until the next meeting, so this event is not even a reason to edit.
                if (event.event === "player-died") return;
                this.update(event.guildId, event.sessionId, (session, previous) =>
                    this.applyGameEvent(session, event, previous),
                );
                return;
            case "game-ended":
                this.update(event.guildId, event.sessionId, (session) => this.applyGameEnded(session, event));
                return;
            case "session-ended":
                await this.end(event.guildId, event.sessionId);
                return;
            default:
                return;
        }
    }

    /** Deletes the status messages a previous process left behind; a respawned cluster starts without sessions. */
    async recover(guildIds: string[]): Promise<void> {
        const rows = await this.deps.tracked.listByGuilds(guildIds, KIND);
        for (const row of rows) await this.discard(row.guildId, row.key);
    }

    /**
     * State changes happen synchronously so events that arrive back to back are applied in order. Each session owns
     * its own message, so parallel games in one guild never replace each other's status.
     */
    private update(
        guildId: string,
        sessionId: string,
        apply: (session: Session, previousDead: Set<string>) => void,
    ): void {
        let session = this.sessions.get(sessionKey(guildId, sessionId));
        if (!session) {
            session = this.createSession(guildId, sessionId);
            this.sessions.set(sessionKey(guildId, sessionId), session);
        }
        apply(session, new Set(session.players.filter((p) => p.dead).map((p) => nameKey(p.name))));
        this.pump(session);
    }

    private createSession(guildId: string, sessionId: string): Session {
        return {
            guildId,
            sessionId,
            phase: "lobby",
            lobbyCode: null,
            hostAccountName: "",
            players: [],
            chain: Promise.resolve(),
            inFlight: 0,
            dirty: false,
            lastRefreshAt: Number.NEGATIVE_INFINITY,
            ended: false,
        };
    }

    private applyGameEvent(session: Session, event: GameEvent, previousDead: Set<string>): void {
        session.phase = phaseOf(event.event);
        session.lobbyCode = event.lobbyCode ?? session.lobbyCode;
        session.hostAccountName = event.hostAccountName;
        const reveals = DEATH_REVEALING_EVENTS.has(event.event);
        session.players = namesOf(event.roster, event.players, event.deadPlayers).map((player) => ({
            name: player.name,
            dead: reveals ? player.dead : event.event !== "lobby" && previousDead.has(nameKey(player.name)),
        }));
    }

    private applyGameEnded(session: Session, event: GameEndedEvent): void {
        session.phase = "lobby";
        session.players = event.roster.map((entry) => ({ name: entry.name, dead: entry.dead }));
    }

    private async end(guildId: string, sessionId: string): Promise<void> {
        const key = sessionKey(guildId, sessionId);
        const session = this.sessions.get(key);
        if (!session) {
            await this.discard(guildId, sessionId);
            return;
        }
        session.ended = true;
        if (session.timer) clearTimeout(session.timer);
        session.timer = undefined;
        this.sessions.delete(key);
        session.chain = session.chain.then(() => this.discard(guildId, sessionId));
        await session.chain;
    }

    /** Never rejects: deleting is best effort and a stale row would only be retried by the next recovery. */
    private async discard(guildId: string, sessionId: string): Promise<void> {
        try {
            const tracked = await this.deps.tracked.get(guildId, KIND, sessionId);
            if (!tracked) return;
            try {
                await this.deps.port.delete(tracked.channelId, tracked.messageId);
            } catch (error) {
                if (!isFinalDeleteError(error)) {
                    logger.warn(
                        logModules.Bot,
                        `Guild ${guildId}: could not delete the status message, keeping its row for a retry`,
                    );
                    return;
                }
            }
            await this.deps.tracked.remove(guildId, KIND, sessionId);
        } catch (error) {
            logger.error(logModules.Bot, `Guild ${guildId}: could not remove the status message`, error);
        }
    }

    private pump(session: Session): void {
        if (session.timer || session.ended) return;
        if (session.inFlight > 0) {
            session.dirty = true;
            return;
        }
        const delay = Math.max(0, session.lastRefreshAt + this.minIntervalMs - this.now());
        session.timer = setTimeout(() => {
            session.timer = undefined;
            void this.run(session);
        }, delay);
        session.timer.unref?.();
    }

    private async run(session: Session): Promise<void> {
        session.inFlight += 1;
        session.dirty = false;
        const task = session.chain.then(() => this.refresh(session));
        session.chain = task;
        try {
            await task;
        } finally {
            session.inFlight -= 1;
            session.lastRefreshAt = this.now();
            if (session.dirty && session.inFlight === 0) this.pump(session);
        }
    }

    /** Never rejects: a failing refresh is logged and the next event tries again. */
    private async refresh(session: Session): Promise<void> {
        const { guildId, sessionId } = session;
        try {
            if (session.ended) return;
            const settings = await this.deps.settings.get(guildId);
            const channelId = settings.status.channelId;
            let tracked = await this.deps.tracked.get(guildId, KIND, sessionId);
            if (tracked && tracked.channelId !== channelId) {
                await this.discard(guildId, sessionId);
                tracked = null;
            }
            if (!channelId || session.ended) return;

            const resolve = createNameResolver(await this.deps.links.listByGuild(guildId));
            const players: StatusPlayer[] = session.players.map((player) => ({
                name: player.name,
                dead: player.dead,
                discordId: resolve(player.name),
            }));
            const components = renderStatus({
                phase: session.phase,
                lobbyCode: session.lobbyCode,
                lobbyCodeMode: settings.status.lobbyCode,
                hostDiscordId: session.hostAccountName ? resolve(session.hostAccountName) : null,
                players,
                locale: settings.language,
            });
            await this.publish(session, channelId, tracked, { components });
        } catch (error) {
            logger.error(logModules.Bot, `Guild ${guildId}: could not update the status message`, error);
        }
    }

    /** Edits the tracked message, or posts a new one when there is none or it was deleted. */
    private async publish(
        session: Session,
        channelId: string,
        tracked: TrackedMessage | null,
        payload: MessagePayload,
    ): Promise<void> {
        const { guildId, sessionId } = session;
        try {
            if (tracked) {
                try {
                    await this.deps.port.edit(tracked.channelId, tracked.messageId, payload);
                    return;
                } catch (error) {
                    if (classifyDiscordError(error) !== "unknown-message") throw error;
                }
            }
            const messageId = await this.deps.port.post(channelId, payload);
            await this.deps.tracked.upsert({
                guildId,
                kind: KIND,
                key: sessionId,
                channelId,
                messageId,
                deleteAt: null,
            });
        } catch (error) {
            this.onFailure(session, channelId, error);
        }
    }

    private onFailure(session: Session, channelId: string, error: unknown): void {
        const failure = classifyDiscordError(error);
        if (failure !== "missing-access" && failure !== "unknown-channel") {
            logger.error(logModules.Bot, `Guild ${session.guildId}: could not update the status message`, error);
            return;
        }
        const now = this.now();
        if (session.lastWarnAt !== undefined && now - session.lastWarnAt < WARN_INTERVAL_MS) return;
        session.lastWarnAt = now;
        logger.warn(
            logModules.Bot,
            `Cannot update the status message in ${channelId} of guild ${session.guildId} (${failure})`,
        );
    }
}
