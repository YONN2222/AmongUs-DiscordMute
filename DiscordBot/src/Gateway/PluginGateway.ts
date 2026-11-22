import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { PluginSessionInfo } from "../Admin/Contract";
import type { LinkingService } from "../Linking/LinkingService";
import { logger, logModules, maskForLog } from "../Logging/Logger";
import type { PluginEventType } from "../Metrics/MetricNames";
import type { PairingService } from "../Pairing/PairingService";
import {
    CLOSE_BLOCKED,
    CLOSE_HELLO_TIMEOUT,
    CLOSE_INVALID_MESSAGE,
    CLOSE_PAIRING_FAILED,
    CLOSE_PROTOCOL_TOO_OLD,
    CLOSE_REPLACED,
    CLOSE_TOO_MANY_SESSIONS,
    CLOSE_UNAUTHORIZED,
    type GameEventName,
    type GatewayMessage,
    MIN_PROTOCOL_VERSION,
    type Platform,
    type PluginMessage,
    PROTOCOL_VERSION,
    parsePluginMessage,
    serialize,
} from "../Protocol/PluginProtocol";
import { type ClusterRouter, sendWithTimeout } from "../Routing/ClusterRouter";
import type { ClusterRequest, RouterReply } from "../Routing/Messages";
import { SlidingWindowLimiter } from "../Utils/SlidingWindowLimiter";
import { unauthorizedMessage } from "../Utils/UnauthorizedHint";
import { createGameSession, type GameSession } from "./GameSession";
import { logPluginMessage } from "./PluginLog";
import type { ResolvedSecret, SecretResolver } from "./SecretResolver";

const WS_PATH = "/ws";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_HELLO_TIMEOUT_MS = 5000;
const DEFAULT_PING_INTERVAL_MS = 15000;
const DEFAULT_PONG_TIMEOUT_MS = 30000;
const DEFAULT_ROUTE_TIMEOUT_MS = 10000;
/** About four minutes in total; ending a session twice is harmless, so a retry never hurts. */
const DEFAULT_SESSION_END_RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000];
const MAX_PENDING_BEFORE_ACTIVE = 16;
const MAX_PENDING_ACTIVE = 64;
/** Link codes are typed by hand; a full lobby of 15 linking at once stays well below this, guessing does not. */
export const LINK_CHAT_LIMIT_PER_MINUTE = 30;
const LINK_CHAT_WINDOW_MS = 60_000;
const DEFAULT_PAIRING_TIMEOUT_MS = 15 * 60 * 1000;
/** Pairing connections per client address; a few retries pass, guessing codes from one address does not. */
export const PAIR_START_LIMIT = 10;
const PAIR_START_WINDOW_MS = 10 * 60 * 1000;
export const MAX_PAIRING_ATTEMPTS = 5;
const TOO_MANY_PAIRING_ATTEMPTS_REASON = "Too many pairing attempts";
const OUTDATED_REASON = "Plugin outdated, please update DiscordMute";
const TOO_MANY_SESSIONS_REASON = "Too many games on this server";
const BLOCKED_REASON = "Blocked";
/** Plugins that send no connection key share this one, so a guild has a single session for them as before. */
const DEFAULT_CONNECTION_KEY = "default";
export const MAX_SESSIONS_PER_GUILD = 25;
const CLUSTER_UNAVAILABLE_MESSAGE = "The Discord bot could not handle this event, please try again shortly";

type GameEventMessage = Extract<PluginMessage, { type: "game-event" }>;
type GameEndMessage = Extract<PluginMessage, { type: "game-end" }>;
type LinkChatMessage = Extract<PluginMessage, { type: "link-chat" }>;
type HelloMessage = Extract<PluginMessage, { type: "hello" }>;
type PairStartMessage = Extract<PluginMessage, { type: "pair-start" }>;
type PairChatMessage = Extract<PluginMessage, { type: "pair-chat" }>;

function sessionKeyOf(guildId: string, connectionKey: string | undefined): string {
    return `${guildId}:${connectionKey ?? DEFAULT_CONNECTION_KEY}`;
}

export interface GatewayObserver {
    sessionStarted(session: GameSession): void;
    sessionEnded(session: GameSession): void;
    pluginMessage(session: GameSession, type: PluginEventType): void;
    gameEventApplied(session: GameSession, event: GameEventName, reply: RouterReply): void;
}

export interface PluginGatewayDeps {
    resolver: SecretResolver;
    router: ClusterRouter;
    linking: LinkingService;
    pairing: Pick<PairingService, "pair">;
    observer?: GatewayObserver;
    /** Self-host logs what its own plugin reports; the hosted bot never writes plugin text into its log. Default true. */
    acceptPluginLogs?: boolean;
    /** Lower-case name of the header a trusted proxy puts the client address into; unset uses the socket address. */
    clientIpHeader?: string;
    helloTimeoutMs?: number;
    /** How long an unpaired plugin may wait for the host to send the pairing code. */
    pairingTimeoutMs?: number;
    pingIntervalMs?: number;
    pongTimeoutMs?: number;
    routeTimeoutMs?: number;
    /** Waits between attempts when the cluster does not confirm a session end. */
    sessionEndRetryDelaysMs?: readonly number[];
}

interface Connection {
    ws: WebSocket;
    clientIp: string;
    /** An unpaired plugin sends pair-start instead of hello and stays in "pairing" until it got its token. */
    state: "awaiting-hello" | "pairing" | "active";
    pairing?: { platform: Platform; attemptsLeft: number };
    session?: GameSession;
    /** Guild and connection key; a new hello with the same key replaces this connection. */
    sessionKey?: string;
    replaced: boolean;
    /** Messages are handled strictly one after another, in the order they arrived. */
    queue: Promise<void>;
    pending: number;
    /** Resolves once the socket closed and any session-ended routing finished. */
    finished: Promise<void>;
    markFinished: () => void;
    helloTimer?: NodeJS.Timeout;
    pairingTimer?: NodeJS.Timeout;
    pingTimer?: NodeJS.Timeout;
    pongDeadline?: NodeJS.Timeout;
}

export class PluginGateway {
    private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    private readonly sessions = new Map<string, Connection>();
    private readonly connections = new Set<Connection>();
    private readonly linkChats = new SlidingWindowLimiter<Connection>(LINK_CHAT_LIMIT_PER_MINUTE, LINK_CHAT_WINDOW_MS);
    private readonly pairStarts = new SlidingWindowLimiter<string>(PAIR_START_LIMIT, PAIR_START_WINDOW_MS);
    private readonly helloTimeoutMs: number;
    private readonly pairingTimeoutMs: number;
    private readonly pingIntervalMs: number;
    private readonly pongTimeoutMs: number;
    private readonly routeTimeoutMs: number;
    private readonly sessionEndRetryDelaysMs: readonly number[];
    private server: Server | null = null;
    private closed = false;
    /** Resolves on close, so retries waiting out a delay stop instead of holding up shutdown. */
    private readonly closedSignal: Promise<void>;
    private signalClosed = (): void => {};

    constructor(private readonly deps: PluginGatewayDeps) {
        this.helloTimeoutMs = deps.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
        this.pairingTimeoutMs = deps.pairingTimeoutMs ?? DEFAULT_PAIRING_TIMEOUT_MS;
        this.pingIntervalMs = deps.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
        this.pongTimeoutMs = deps.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
        this.routeTimeoutMs = deps.routeTimeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS;
        this.sessionEndRetryDelaysMs = deps.sessionEndRetryDelaysMs ?? DEFAULT_SESSION_END_RETRY_DELAYS_MS;
        this.closedSignal = new Promise<void>((resolve) => {
            this.signalClosed = resolve;
        });
        if (this.pongTimeoutMs <= this.pingIntervalMs) {
            throw new Error(
                `pongTimeoutMs (${this.pongTimeoutMs}) must be greater than pingIntervalMs (${this.pingIntervalMs})`,
            );
        }
    }

    attach(server: Server): void {
        this.server = server;
        server.on("upgrade", this.handleUpgrade);
    }

    /** Any game of the guild can show the link phrase, so it goes to every open session. */
    pushLinkPending(guildId: string, phrase: string, quickChatCode: string, discordId: string): boolean {
        const open = this.openConnectionsOf(guildId);
        for (const conn of open) this.send(conn, { type: "link-pending", phrase, quickChatCode, discordId });
        return open.length > 0;
    }

    isConnected(guildId: string): boolean {
        return this.openConnectionsOf(guildId).length > 0;
    }

    sessionCount(): number {
        return this.sessions.size;
    }

    sessionsOfGuild(guildId: string): number {
        return this.connectionsOf(guildId).length;
    }

    /** What the admin API may show about the guild's sessions; nothing about the connection itself. */
    sessionsInfo(guildId: string): PluginSessionInfo[] {
        return this.connectionsOf(guildId)
            .flatMap(({ session }) => (session ? [session] : []))
            .map(({ sessionId, connectedAt, pluginVersion, gameVersion, protocolVersion, platform }) => ({
                sessionId,
                connectedAt,
                pluginVersion,
                gameVersion,
                protocolVersion,
                ...(platform ? { platform } : {}),
            }));
    }

    /** Closes every session of the guild; each close ends its session like a normal disconnect. */
    disconnectGuild(guildId: string, code: number, reason: string): number {
        const connections = this.connectionsOf(guildId);
        for (const conn of connections) conn.ws.close(code, reason);
        if (connections.length > 0) {
            logger.info(logModules.WebServer, `Closed ${connections.length} plugin session(s) of guild ${guildId}`);
        }
        return connections.length;
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        this.signalClosed();
        this.server?.off("upgrade", this.handleUpgrade);
        const open = [...this.connections];
        for (const conn of open) {
            this.clearTimers(conn);
            conn.ws.terminate();
        }
        await Promise.all(open.map((conn) => conn.finished));
        await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    }

    private readonly handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const url = new URL(req.url ?? "", "http://localhost");
        if (this.closed || url.pathname !== WS_PATH) {
            socket.destroy();
            return;
        }
        // 2.x plugins authenticate with the secret in the query instead of a hello message.
        if (url.searchParams.has("secret")) {
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                logger.warn(logModules.WebServer, "DiscordMute plugin 2.x connected, please update the plugin");
                ws.on("error", (error) => logger.error(logModules.WebServer, "Plugin WebSocket error", error));
                ws.close(CLOSE_PROTOCOL_TOO_OLD, OUTDATED_REASON);
            });
            return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, this.clientIpOf(req)));
    };

    private clientIpOf(req: IncomingMessage): string {
        const header = this.deps.clientIpHeader;
        const forwarded = header ? req.headers[header] : undefined;
        if (typeof forwarded === "string" && forwarded !== "") return forwarded;
        return req.socket.remoteAddress ?? "unknown";
    }

    private accept(ws: WebSocket, clientIp: string): void {
        let markFinished = (): void => {};
        const finished = new Promise<void>((resolve) => {
            markFinished = resolve;
        });
        const conn: Connection = {
            ws,
            clientIp,
            state: "awaiting-hello",
            replaced: false,
            queue: Promise.resolve(),
            pending: 0,
            finished,
            markFinished,
        };
        this.connections.add(conn);
        // Stays armed while the secret is being resolved, so a hung resolver still ends in 4000.
        conn.helloTimer = setTimeout(() => ws.close(CLOSE_HELLO_TIMEOUT, "Hello timeout"), this.helloTimeoutMs);

        ws.on("message", (data, isBinary) => this.enqueue(conn, data, isBinary));
        ws.on("pong", () => this.armPongDeadline(conn));
        ws.on("close", () => void this.onClose(conn));
        ws.on("error", (error) => logger.error(logModules.WebServer, "Plugin WebSocket error", error));
    }

    private enqueue(conn: Connection, data: RawData, isBinary: boolean): void {
        if (conn.ws.readyState !== WebSocket.OPEN) return;
        const limit = conn.state === "active" ? MAX_PENDING_ACTIVE : MAX_PENDING_BEFORE_ACTIVE;
        if (conn.pending >= limit) {
            logger.warn(logModules.WebServer, "Plugin sent messages faster than they can be handled, closing");
            conn.ws.close(CLOSE_INVALID_MESSAGE, "Too many pending messages");
            return;
        }
        conn.pending++;
        conn.queue = conn.queue
            .then(() => this.onMessage(conn, data, isBinary))
            .finally(() => {
                conn.pending--;
            });
    }

    private async onMessage(conn: Connection, data: RawData, isBinary: boolean): Promise<void> {
        try {
            await this.handleMessage(conn, data, isBinary);
        } catch (error) {
            logger.error(logModules.WebServer, "Failed to handle plugin message", error);
        }
    }

    private async handleMessage(conn: Connection, data: RawData, isBinary: boolean): Promise<void> {
        if (conn.replaced || conn.ws.readyState !== WebSocket.OPEN) return;

        const message = isBinary ? null : parsePluginMessage(data.toString());
        if (!message) {
            conn.ws.close(CLOSE_INVALID_MESSAGE, "Invalid message");
            return;
        }

        if (conn.state === "awaiting-hello") {
            if (message.type === "hello") await this.onHello(conn, message);
            else if (message.type === "pair-start") this.onPairStart(conn, message);
            else conn.ws.close(CLOSE_INVALID_MESSAGE, "Expected hello");
            return;
        }

        if (conn.state === "pairing") {
            if (message.type === "pair-chat") await this.onPairChat(conn, message);
            else conn.ws.close(CLOSE_INVALID_MESSAGE, "Expected pair-chat");
            return;
        }

        await this.dispatch(conn, message);
    }

    private async resolveSecret(secret: string): Promise<ResolvedSecret | null> {
        try {
            return await this.deps.resolver.resolve(secret);
        } catch (error) {
            logger.error(logModules.WebServer, "Secret resolution failed", error);
            return null;
        }
    }

    private connectionsOf(guildId: string): Connection[] {
        return [...this.sessions.values()].filter((conn) => conn.session?.guildId === guildId);
    }

    private openConnectionsOf(guildId: string): Connection[] {
        return this.connectionsOf(guildId).filter((conn) => conn.ws.readyState === WebSocket.OPEN);
    }

    private async onHello(conn: Connection, hello: HelloMessage): Promise<void> {
        const resolved = await this.resolveSecret(hello.secret);
        if (conn.ws.readyState !== WebSocket.OPEN) return;
        if (!resolved) {
            logger.warn(logModules.WebServer, unauthorizedMessage("Rejected plugin connection", hello.secret));
            conn.ws.close(CLOSE_UNAUTHORIZED, "Unauthorized");
            return;
        }
        if (resolved.blocked) {
            logger.warn(logModules.WebServer, `Rejected plugin connection for blocked guild ${resolved.guildId}`);
            conn.ws.close(CLOSE_BLOCKED, BLOCKED_REASON);
            return;
        }
        if (this.refuseOutdated(conn, hello.protocolVersion)) return;

        this.activate(conn, resolved.guildId, hello);
    }

    /** Closes the connection when the plugin speaks a protocol the gateway no longer supports. */
    private refuseOutdated(conn: Connection, protocolVersion: number): boolean {
        if (protocolVersion >= MIN_PROTOCOL_VERSION) return false;
        logger.warn(logModules.WebServer, `Rejected plugin with protocol version ${protocolVersion}`);
        conn.ws.close(CLOSE_PROTOCOL_TOO_OLD, OUTDATED_REASON);
        return true;
    }

    private onPairStart(conn: Connection, start: PairStartMessage): void {
        if (!this.pairStarts.tryHit(conn.clientIp)) {
            logger.warn(logModules.WebServer, "Too many pairing connections from one address, closing");
            conn.ws.close(CLOSE_PAIRING_FAILED, TOO_MANY_PAIRING_ATTEMPTS_REASON);
            return;
        }
        if (this.refuseOutdated(conn, start.protocolVersion)) return;

        clearTimeout(conn.helloTimer);
        conn.state = "pairing";
        conn.pairing = { platform: start.platform, attemptsLeft: MAX_PAIRING_ATTEMPTS };
        conn.pairingTimer = setTimeout(
            () => conn.ws.close(CLOSE_PAIRING_FAILED, "Pairing timeout"),
            this.pairingTimeoutMs,
        );
        this.startHeartbeat(conn);
        logger.info(
            logModules.WebServer,
            `Plugin ${start.pluginVersion} (game ${start.gameVersion}, ${start.platform}) is waiting to be paired`,
        );
    }

    private async onPairChat(conn: Connection, message: PairChatMessage): Promise<void> {
        const pairing = conn.pairing;
        if (!pairing) return;
        let paired: Awaited<ReturnType<PairingService["pair"]>>;
        try {
            paired = await this.deps.pairing.pair(message.code, pairing.platform);
        } catch (error) {
            logger.error(logModules.WebServer, "Pairing a device failed", error);
            conn.ws.close(CLOSE_PAIRING_FAILED, "Pairing failed, please try again");
            return;
        }
        if (!paired) {
            pairing.attemptsLeft--;
            this.send(conn, { type: "pair-result", ok: false, attemptsLeft: pairing.attemptsLeft });
            if (pairing.attemptsLeft <= 0) conn.ws.close(CLOSE_PAIRING_FAILED, TOO_MANY_PAIRING_ATTEMPTS_REASON);
            return;
        }
        this.send(conn, { type: "paired", secret: paired.secret, guildName: paired.guildName });
        logger.success(logModules.WebServer, `Paired a ${pairing.platform} device with guild ${paired.guildId}`);
        // The plugin reconnects with a normal hello and its new token.
        conn.ws.close(1000, "Paired");
    }

    private activate(conn: Connection, guildId: string, hello: HelloMessage): void {
        const { pluginVersion, gameVersion, protocolVersion } = hello;
        const sessionKey = sessionKeyOf(guildId, hello.connectionKey);
        const previous = this.sessions.get(sessionKey);
        if (!previous && this.sessionsOfGuild(guildId) >= MAX_SESSIONS_PER_GUILD) {
            logger.warn(logModules.WebServer, `Rejected plugin for guild ${guildId}: too many parallel games`);
            conn.ws.close(CLOSE_TOO_MANY_SESSIONS, TOO_MANY_SESSIONS_REASON);
            return;
        }
        const sessionId = previous?.session?.sessionId;
        if (previous) {
            previous.replaced = true;
            this.clearTimers(previous);
            previous.ws.close(CLOSE_REPLACED, "Replaced by a new connection");
        }

        clearTimeout(conn.helloTimer);
        conn.session = createGameSession(
            guildId,
            pluginVersion,
            gameVersion,
            protocolVersion,
            sessionId,
            hello.platform,
        );
        conn.sessionKey = sessionKey;
        conn.state = "active";
        this.sessions.set(sessionKey, conn);
        this.startHeartbeat(conn);
        this.send(conn, { type: "welcome", protocolVersion: PROTOCOL_VERSION });
        logger.success(
            logModules.WebServer,
            `Plugin ${pluginVersion} (game ${gameVersion}, ${hello.platform ?? "unknown platform"}) connected for guild ${guildId}${previous ? ", replacing the previous connection" : ""}`,
        );
        const session = conn.session;
        this.observe((observer) => observer.sessionStarted(session));
        // Not awaited, so a slow cluster never holds back the messages queued behind hello.
        void this.routeLogged(session.guildId, {
            kind: "session-started",
            guildId,
            sessionId: session.sessionId,
            pluginVersion,
            gameVersion,
            protocolVersion,
        });
    }

    private observe(call: (observer: GatewayObserver) => void): void {
        const observer = this.deps.observer;
        if (!observer) return;
        try {
            call(observer);
        } catch (error) {
            logger.debug(logModules.WebServer, `Gateway observer failed: ${String(error)}`);
        }
    }

    private async dispatch(conn: Connection, message: PluginMessage): Promise<void> {
        const session = conn.session;
        if (!session) return;
        switch (message.type) {
            case "game-event":
                await this.onGameEvent(conn, session, message);
                return;
            case "game-end":
                await this.onGameEnd(session, message);
                return;
            case "link-chat":
                if (!this.linkChats.tryHit(conn)) {
                    logger.warn(logModules.WebServer, `Too many link codes from guild ${session.guildId}, closing`);
                    conn.ws.close(CLOSE_INVALID_MESSAGE, "Too many link codes");
                    return;
                }
                await this.onLinkChat(conn, session, message);
                return;
            case "plugin-log":
                if (this.deps.acceptPluginLogs ?? true) logPluginMessage(message);
                return;
            case "hello":
                conn.ws.close(CLOSE_INVALID_MESSAGE, "Duplicate hello");
                return;
            case "pair-start":
            case "pair-chat":
                conn.ws.close(CLOSE_INVALID_MESSAGE, "Already paired");
                return;
        }
    }

    private async onGameEvent(conn: Connection, session: GameSession, message: GameEventMessage): Promise<void> {
        this.observe((observer) => observer.pluginMessage(session, message.event));
        const reply = await this.route(session.guildId, {
            kind: "game-event",
            guildId: session.guildId,
            sessionId: session.sessionId,
            hostAccountName: message.hostAccountName,
            event: message.event,
            players: message.players,
            deadPlayers: message.deadPlayers,
            ...(message.roster ? { roster: message.roster } : {}),
            ...(message.lobbyCode ? { lobbyCode: message.lobbyCode } : {}),
        });
        this.observe((observer) => observer.gameEventApplied(session, message.event, reply));
        if (!reply.ok) {
            logger.warn(logModules.WebServer, `Game event for guild ${session.guildId} failed: ${reply.error}`);
            this.send(conn, { type: "notice", code: "cluster-unavailable", message: CLUSTER_UNAVAILABLE_MESSAGE });
        } else if (reply.notice) {
            this.send(conn, { type: "notice", ...reply.notice });
            if (reply.notice.code === "host-blocked") conn.ws.close(CLOSE_BLOCKED, BLOCKED_REASON);
        }
    }

    private async onGameEnd(session: GameSession, message: GameEndMessage): Promise<void> {
        this.observe((observer) => observer.pluginMessage(session, "game-end"));
        await this.routeLogged(session.guildId, {
            kind: "game-ended",
            guildId: session.guildId,
            sessionId: session.sessionId,
            reason: message.reason,
            winners: message.winners,
            roster: message.roster,
        });
    }

    private async onLinkChat(conn: Connection, session: GameSession, message: LinkChatMessage): Promise<void> {
        this.observe((observer) => observer.pluginMessage(session, "link-chat"));
        let confirmed: Awaited<ReturnType<LinkingService["confirmLink"]>>;
        try {
            confirmed = await this.deps.linking.confirmLink(
                session.guildId,
                message.code,
                message.accountName,
                message.friendCode,
            );
        } catch (error) {
            logger.error(logModules.WebServer, `Could not confirm link code "${message.code}"`, error);
            this.send(conn, { type: "link-result", status: "not-found", accountName: message.accountName });
            return;
        }
        this.send(conn, {
            type: "link-result",
            status: confirmed ? "linked" : "not-found",
            accountName: message.accountName,
        });
        if (!confirmed) {
            logger.warn(logModules.Link, `No pending link for code ${maskForLog(message.code)}`);
            return;
        }
        const reply = await this.route(confirmed.guildId, {
            kind: "link-confirmed",
            ...confirmed,
            ...(message.friendCode ? { friendCode: message.friendCode } : {}),
        });
        if (!reply.ok) {
            logger.warn(
                logModules.WebServer,
                `Link confirmation for guild ${confirmed.guildId} failed: ${reply.error}`,
            );
        }
    }

    private async onClose(conn: Connection): Promise<void> {
        this.clearTimers(conn);
        this.connections.delete(conn);
        this.linkChats.forget(conn);
        try {
            await this.endSession(conn);
        } finally {
            conn.markFinished();
        }
    }

    private async endSession(conn: Connection): Promise<void> {
        const { session, sessionKey } = conn;
        if (conn.replaced || !session || !sessionKey || this.sessions.get(sessionKey) !== conn) return;

        this.sessions.delete(sessionKey);
        this.observe((observer) => observer.sessionEnded(session));
        logger.warn(logModules.WebServer, `Plugin disconnected for guild ${session.guildId}`);
        // A game event still being routed has to reach the cluster before the end, or it could restart the game there.
        await conn.queue;
        await this.routeSessionEnded(session);
    }

    /** Retries until the cluster confirms, because an unconfirmed end can leave members muted until a restart. */
    private async routeSessionEnded({ guildId, sessionId }: GameSession): Promise<void> {
        const req: ClusterRequest = { kind: "session-ended", guildId, sessionId };
        let reply = await this.route(guildId, req);
        for (const delayMs of this.sessionEndRetryDelaysMs) {
            if (reply.ok || this.closed) break;
            logger.warn(
                logModules.WebServer,
                `session-ended for guild ${guildId} failed (${reply.error}), retrying in ${delayMs} ms`,
            );
            await this.waitUnlessClosed(delayMs);
            if (this.closed) break;
            reply = await this.route(guildId, req);
        }
        if (!reply.ok) logger.error(logModules.WebServer, `session-ended for guild ${guildId} failed: ${reply.error}`);
    }

    private waitUnlessClosed(ms: number): Promise<void> {
        let timer: NodeJS.Timeout | undefined;
        const elapsed = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
        });
        return Promise.race([elapsed, this.closedSignal]).finally(() => clearTimeout(timer));
    }

    private startHeartbeat(conn: Connection): void {
        this.armPongDeadline(conn);
        conn.pingTimer = setInterval(() => conn.ws.ping(), this.pingIntervalMs);
    }

    private armPongDeadline(conn: Connection): void {
        clearTimeout(conn.pongDeadline);
        // A pairing connection gets pings too, so proxies do not drop it while the host is still in the menus.
        if (conn.state === "awaiting-hello" || conn.replaced) return;
        conn.pongDeadline = setTimeout(() => {
            logger.warn(logModules.WebServer, "Plugin did not answer pings, terminating connection");
            conn.ws.terminate();
        }, this.pongTimeoutMs);
    }

    private route(guildId: string, req: ClusterRequest): Promise<RouterReply> {
        return sendWithTimeout(this.deps.router, guildId, req, this.routeTimeoutMs);
    }

    private async routeLogged(guildId: string, req: ClusterRequest): Promise<void> {
        const reply = await this.route(guildId, req);
        if (!reply.ok) logger.warn(logModules.WebServer, `${req.kind} for guild ${guildId} failed: ${reply.error}`);
    }

    private send(conn: Connection, message: GatewayMessage): void {
        if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(serialize(message));
    }

    private clearTimers(conn: Connection): void {
        clearTimeout(conn.helloTimer);
        clearTimeout(conn.pairingTimer);
        clearInterval(conn.pingTimer);
        clearTimeout(conn.pongDeadline);
    }
}
