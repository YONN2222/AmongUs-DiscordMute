import { classifyDiscordError, type MessagePort } from "../Cluster/messagePort";
import type { GuildEvent } from "../Events/GuildEvents";
import { type Locale, t } from "../i18n";
import { logger, logModules } from "../Logging/logger";
import type { SettingsService } from "../Settings/SettingsService";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { formatLogLine } from "./formatLogLine";

const QUEUE_CAP = 50;
const MAX_TEXT_LENGTH = 3800;
const MAX_LINE_LENGTH = 1000;
const THROTTLE_MS = 10 * 60_000;
const DEFAULT_FLUSH_MS = 2000;

interface LogChannelDeps {
    port: MessagePort;
    settings: Pick<SettingsService, "get">;
    now?: () => number;
    flushMs?: number;
    names?: (discordId: string) => string;
}

interface GuildLog {
    channelId: string;
    locale: Locale;
    lines: string[];
    overflow: number;
    timer?: ReturnType<typeof setTimeout>;
    chain: Promise<void>;
}

/** Collects the public server log per guild and posts it as a few bundled messages instead of one per event. */
export class LogChannelWriter {
    private readonly guilds = new Map<string, GuildLog>();
    private readonly sessions = new Map<string, string>();
    private readonly voiceErrorAt = new Map<string, number>();
    private readonly blocked = new Map<string, { channelId: string; until: number }>();
    private readonly now: () => number;
    private readonly flushMs: number;
    private readonly names: (discordId: string) => string;

    constructor(private readonly deps: LogChannelDeps) {
        this.now = deps.now ?? Date.now;
        this.flushMs = deps.flushMs ?? DEFAULT_FLUSH_MS;
        this.names = deps.names ?? (() => "");
    }

    async handle(event: GuildEvent): Promise<void> {
        const settings = await this.deps.settings.get(event.guildId);
        const target =
            event.type === "settings-changed"
                ? { channelId: event.after.logChannelId ?? event.before.logChannelId, locale: event.after.language }
                : { channelId: settings.logChannelId, locale: settings.language };

        const implicitSession = this.trackSession(event);
        if (!target.channelId) return;
        if (event.type === "settings-changed") this.blocked.delete(event.guildId);
        const blocked = this.blocked.get(event.guildId);
        if (blocked?.channelId === target.channelId && this.now() < blocked.until) return;
        if (implicitSession === "skip") return;
        if (event.type === "voice-error" && this.throttled(event)) return;

        const lines: string[] = [];
        if (implicitSession === "implicit") lines.push(t(target.locale, "log.sessionStartedImplicit"));
        const line = formatLogLine(event, target.locale, this.names);
        if (line) lines.push(line);
        await this.enqueue(event.guildId, target.channelId, target.locale, lines);
    }

    async flushAll(): Promise<void> {
        for (const [guildId, log] of this.guilds) {
            while (log.lines.length > 0 || log.overflow > 0) {
                const before = log.lines.length + log.overflow;
                await this.flushOnce(guildId, log);
                if (log.lines.length + log.overflow >= before) break;
            }
            await log.chain;
        }
    }

    /**
     * Sessions are announced once: a repeated session-started is skipped, and a game event of an unseen
     * session counts as its start. The end of a session that was already replaced is skipped as well.
     */
    private trackSession(event: GuildEvent): "implicit" | "skip" | "normal" {
        const current = this.sessions.get(event.guildId);
        switch (event.type) {
            case "session-started":
                this.sessions.set(event.guildId, event.sessionId);
                return current === event.sessionId ? "skip" : "normal";
            case "session-ended":
                if (current !== undefined && current !== event.sessionId) return "skip";
                this.sessions.delete(event.guildId);
                return "normal";
            case "game-event":
            case "game-ended":
                if (current === event.sessionId) return "normal";
                this.sessions.set(event.guildId, event.sessionId);
                return "implicit";
            default:
                return "normal";
        }
    }

    private throttled(event: Extract<GuildEvent, { type: "voice-error" }>): boolean {
        const key = `${event.guildId}:${event.code}`;
        const last = this.voiceErrorAt.get(key);
        const now = this.now();
        if (last !== undefined && now - last < THROTTLE_MS) return true;
        this.voiceErrorAt.set(key, now);
        return false;
    }

    private async enqueue(guildId: string, channelId: string, locale: Locale, lines: string[]): Promise<void> {
        let log = this.guilds.get(guildId);
        if (log && log.channelId !== channelId && log.lines.length > 0) await this.flushOnce(guildId, log);
        if (!log) {
            log = { channelId, locale, lines: [], overflow: 0, chain: Promise.resolve() };
            this.guilds.set(guildId, log);
        }
        log.channelId = channelId;
        log.locale = locale;

        for (const line of lines) {
            if (log.lines.length >= QUEUE_CAP) log.overflow += 1;
            else log.lines.push(line.slice(0, MAX_LINE_LENGTH));
        }
        this.schedule(guildId, log);
    }

    private schedule(guildId: string, log: GuildLog): void {
        if (log.timer || (log.lines.length === 0 && log.overflow === 0)) return;
        log.timer = setTimeout(() => {
            log.timer = undefined;
            void this.flushOnce(guildId, log).then(() => this.schedule(guildId, log));
        }, this.flushMs);
        log.timer.unref?.();
    }

    private flushOnce(guildId: string, log: GuildLog): Promise<void> {
        if (log.timer) {
            clearTimeout(log.timer);
            log.timer = undefined;
        }
        log.chain = log.chain.then(() => this.post(guildId, log));
        return log.chain;
    }

    private takeChunk(log: GuildLog): string {
        const moreLine = log.overflow > 0 ? t(log.locale, "log.more", { count: log.overflow }) : "";
        const limit = MAX_TEXT_LENGTH - (moreLine ? moreLine.length + 1 : 0);
        const chunk: string[] = [];
        let length = 0;
        while (log.lines.length > 0) {
            const next = log.lines[0];
            const added = next.length + (chunk.length > 0 ? 1 : 0);
            if (chunk.length > 0 && length + added > limit) break;
            chunk.push(next);
            length += added;
            log.lines.shift();
        }
        if (log.lines.length === 0 && moreLine) {
            chunk.push(moreLine);
            log.overflow = 0;
        }
        return chunk.join("\n");
    }

    private async post(guildId: string, log: GuildLog): Promise<void> {
        if (log.lines.length === 0 && log.overflow === 0) return;
        const channelId = log.channelId;
        const text = this.takeChunk(log);
        try {
            await this.deps.port.post(channelId, { components: [new ContainerBuilder().text(text).toJSON()] });
        } catch (error) {
            this.onPostFailed(guildId, log, channelId, error);
        }
    }

    private onPostFailed(guildId: string, log: GuildLog, channelId: string, error: unknown): void {
        const failure = classifyDiscordError(error);
        if (failure === "missing-access" || failure === "unknown-channel") {
            log.lines = [];
            log.overflow = 0;
            this.blocked.set(guildId, { channelId, until: this.now() + THROTTLE_MS });
            logger.warn(
                logModules.Bot,
                `Cannot post to the log channel ${channelId} of guild ${guildId} (${failure}); the log is paused for 10 minutes`,
            );
            return;
        }
        logger.error(logModules.Bot, `Failed to post to the log channel ${channelId} of guild ${guildId}`, error);
    }
}
