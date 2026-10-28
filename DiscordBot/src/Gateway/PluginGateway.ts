import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { logger, logModules } from "../Logging/logger";
import {
    CLOSE_HELLO_TIMEOUT,
    CLOSE_INVALID_MESSAGE,
    CLOSE_PROTOCOL_TOO_OLD,
    CLOSE_REPLACED,
    CLOSE_UNAUTHORIZED,
    type GatewayMessage,
    MIN_PROTOCOL_VERSION,
    type PluginMessage,
    PROTOCOL_VERSION,
    parsePluginMessage,
    serialize,
} from "../Protocol/PluginProtocol";
import type { ClusterRouter } from "../Routing/ClusterRouter";
import type { ClusterRequest, RouterReply } from "../Routing/messages";
import type { LinkingService } from "../Utils/LinkingService";
import { unauthorizedMessage } from "../Utils/UnauthorizedHint";
import { createGameSession, type GameSession } from "./GameSession";
import type { ResolvedSecret, SecretResolver } from "./SecretResolver";

const WS_PATH = "/ws";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_HELLO_TIMEOUT_MS = 5000;
const DEFAULT_PING_INTERVAL_MS = 15000;
const DEFAULT_PONG_TIMEOUT_MS = 30000;
const DEFAULT_ROUTE_TIMEOUT_MS = 10000;
const MAX_PENDING_BEFORE_ACTIVE = 16;
const MAX_PENDING_ACTIVE = 64;
const OUTDATED_REASON = "Plugin outdated, please update DiscordMute";
const CLUSTER_UNAVAILABLE_MESSAGE = "The Discord bot could not handle this event, please try again shortly";

type GameEventMessage = Extract<PluginMessage, { type: "game-event" }>;
type LinkChatMessage = Extract<PluginMessage, { type: "link-chat" }>;
type PluginLogMessage = Extract<PluginMessage, { type: "plugin-log" }>;

export interface PluginGatewayDeps {
    resolver: SecretResolver;
    router: ClusterRouter;
    linking: LinkingService;
    helloTimeoutMs?: number;
    pingIntervalMs?: number;
    pongTimeoutMs?: number;
    routeTimeoutMs?: number;
}

interface Connection {
    ws: WebSocket;
    state: "awaiting-hello" | "active";
    session?: GameSession;
    replaced: boolean;
    /** Messages are handled strictly one after another, in the order they arrived. */
    queue: Promise<void>;
    pending: number;
    /** Resolves once the socket closed and any session-ended routing finished. */
    finished: Promise<void>;
    markFinished: () => void;
    helloTimer?: NodeJS.Timeout;
    pingTimer?: NodeJS.Timeout;
    pongDeadline?: NodeJS.Timeout;
}

export class PluginGateway {
    private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    private readonly sessions = new Map<string, Connection>();
    private readonly connections = new Set<Connection>();
    private readonly helloTimeoutMs: number;
    private readonly pingIntervalMs: number;
    private readonly pongTimeoutMs: number;
    private readonly routeTimeoutMs: number;
    private server: Server | null = null;
    private closed = false;

    constructor(private readonly deps: PluginGatewayDeps) {
        this.helloTimeoutMs = deps.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
        this.pingIntervalMs = deps.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
        this.pongTimeoutMs = deps.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
        this.routeTimeoutMs = deps.routeTimeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS;
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

    pushLinkPending(guildId: string, phrase: string, quickChatCode: string, discordId: string): boolean {
        const conn = this.sessions.get(guildId);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false;
        this.send(conn, { type: "link-pending", phrase, quickChatCode, discordId });
        return true;
    }

    isConnected(guildId: string): boolean {
        return this.sessions.get(guildId)?.ws.readyState === WebSocket.OPEN;
    }

    sessionCount(): number {
        return this.sessions.size;
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
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
        const pathname = new URL(req.url ?? "", "http://localhost").pathname;
        if (this.closed || pathname !== WS_PATH) {
            socket.destroy();
            return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    };

    private accept(ws: WebSocket): void {
        let markFinished = (): void => {};
        const finished = new Promise<void>((resolve) => {
            markFinished = resolve;
        });
        const conn: Connection = {
            ws,
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
            if (message.type !== "hello") {
                conn.ws.close(CLOSE_INVALID_MESSAGE, "Expected hello");
                return;
            }
            await this.onHello(conn, message);
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

    private async onHello(conn: Connection, hello: Extract<PluginMessage, { type: "hello" }>): Promise<void> {
        const resolved = await this.resolveSecret(hello.secret);
        if (conn.ws.readyState !== WebSocket.OPEN) return;
        if (!resolved) {
            logger.warn(logModules.WebServer, unauthorizedMessage("Rejected plugin connection", hello.secret));
            conn.ws.close(CLOSE_UNAUTHORIZED, "Unauthorized");
            return;
        }
        if (hello.protocolVersion < MIN_PROTOCOL_VERSION) {
            logger.warn(logModules.WebServer, `Rejected plugin with protocol version ${hello.protocolVersion}`);
            conn.ws.close(CLOSE_PROTOCOL_TOO_OLD, OUTDATED_REASON);
            return;
        }

        this.activate(conn, resolved.guildId, hello.pluginVersion, hello.gameVersion);
    }

    private activate(conn: Connection, guildId: string, pluginVersion: string, gameVersion: string): void {
        const previous = this.sessions.get(guildId);
        const sessionId = previous?.session?.sessionId;
        if (previous) {
            previous.replaced = true;
            this.clearTimers(previous);
            previous.ws.close(CLOSE_REPLACED, "Replaced by a new connection");
        }

        clearTimeout(conn.helloTimer);
        conn.session = createGameSession(guildId, pluginVersion, gameVersion, sessionId);
        conn.state = "active";
        this.sessions.set(guildId, conn);
        this.startHeartbeat(conn);
        this.send(conn, { type: "welcome", protocolVersion: PROTOCOL_VERSION });
        logger.success(
            logModules.WebServer,
            `Plugin ${pluginVersion} (game ${gameVersion}) connected for guild ${guildId}${previous ? ", replacing the previous connection" : ""}`,
        );
    }

    private async dispatch(conn: Connection, message: PluginMessage): Promise<void> {
        const session = conn.session;
        if (!session) return;
        switch (message.type) {
            case "game-event":
                await this.onGameEvent(conn, session, message);
                return;
            case "link-chat":
                await this.onLinkChat(conn, message);
                return;
            case "plugin-log":
                this.onPluginLog(message);
                return;
            case "hello":
                conn.ws.close(CLOSE_INVALID_MESSAGE, "Duplicate hello");
                return;
        }
    }

    private async onGameEvent(conn: Connection, session: GameSession, message: GameEventMessage): Promise<void> {
        const reply = await this.route(session.guildId, {
            kind: "game-event",
            guildId: session.guildId,
            sessionId: session.sessionId,
            hostAccountName: message.hostAccountName,
            event: message.event,
            players: message.players,
            deadPlayers: message.deadPlayers,
        });
        if (!reply.ok) {
            logger.warn(logModules.WebServer, `Game event for guild ${session.guildId} failed: ${reply.error}`);
            this.send(conn, { type: "notice", code: "cluster-unavailable", message: CLUSTER_UNAVAILABLE_MESSAGE });
        } else if (reply.notice) {
            this.send(conn, { type: "notice", ...reply.notice });
        }
    }

    private async onLinkChat(conn: Connection, message: LinkChatMessage): Promise<void> {
        let confirmed: Awaited<ReturnType<LinkingService["confirmLink"]>> = null;
        try {
            confirmed = await this.deps.linking.confirmLink(message.code, message.accountName);
        } catch (error) {
            logger.error(logModules.WebServer, `Could not confirm link code "${message.code}"`, error);
        }
        this.send(conn, {
            type: "link-result",
            status: confirmed ? "linked" : "not-found",
            accountName: message.accountName,
        });
        if (!confirmed) {
            logger.warn(logModules.WebServer, `No pending link found for code "${message.code}"`);
            return;
        }
        const reply = await this.route(confirmed.guildId, { kind: "link-confirmed", ...confirmed });
        if (!reply.ok) {
            logger.warn(
                logModules.WebServer,
                `Link confirmation for guild ${confirmed.guildId} failed: ${reply.error}`,
            );
        }
    }

    private onPluginLog(message: PluginLogMessage): void {
        const text = `[${message.source}] ${message.message}`;
        switch (message.level) {
            case "debug":
                logger.debug(logModules.AmongUs, text);
                return;
            case "warning":
                logger.warn(logModules.AmongUs, text);
                return;
            case "error":
            case "fatal":
                logger.error(logModules.AmongUs, text);
                return;
            default:
                logger.info(logModules.AmongUs, text);
        }
    }

    private async onClose(conn: Connection): Promise<void> {
        this.clearTimers(conn);
        this.connections.delete(conn);
        try {
            await this.endSession(conn);
        } finally {
            conn.markFinished();
        }
    }

    private async endSession(conn: Connection): Promise<void> {
        const session = conn.session;
        if (conn.replaced || !session || this.sessions.get(session.guildId) !== conn) return;

        this.sessions.delete(session.guildId);
        logger.warn(logModules.WebServer, `Plugin disconnected for guild ${session.guildId}`);
        const reply = await this.route(session.guildId, {
            kind: "session-ended",
            guildId: session.guildId,
            sessionId: session.sessionId,
        });
        if (!reply.ok) {
            logger.warn(logModules.WebServer, `session-ended for guild ${session.guildId} failed: ${reply.error}`);
        }
    }

    private startHeartbeat(conn: Connection): void {
        this.armPongDeadline(conn);
        conn.pingTimer = setInterval(() => conn.ws.ping(), this.pingIntervalMs);
    }

    private armPongDeadline(conn: Connection): void {
        clearTimeout(conn.pongDeadline);
        if (conn.state !== "active" || conn.replaced) return;
        conn.pongDeadline = setTimeout(() => {
            logger.warn(logModules.WebServer, "Plugin did not answer pings, terminating connection");
            conn.ws.terminate();
        }, this.pongTimeoutMs);
    }

    private async route(guildId: string, req: ClusterRequest): Promise<RouterReply> {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<RouterReply>((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), this.routeTimeoutMs);
        });
        try {
            return await Promise.race([this.deps.router.send(guildId, req), timeout]);
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        } finally {
            clearTimeout(timer);
        }
    }

    private send(conn: Connection, message: GatewayMessage): void {
        if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(serialize(message));
    }

    private clearTimers(conn: Connection): void {
        clearTimeout(conn.helloTimer);
        clearInterval(conn.pingTimer);
        clearTimeout(conn.pongDeadline);
    }
}
