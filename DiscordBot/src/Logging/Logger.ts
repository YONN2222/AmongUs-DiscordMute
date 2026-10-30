import chalk from "chalk";

export type LogLevel = "info" | "warn" | "error" | "success" | "debug";

export interface LogModule {
    name: string;
    tint: string;
}

export const logTheme = {
    info: "#22d3f6",
    warn: "#f8bd45",
    error: "#f13a3a",
    success: "#28e768",
    debug: "#bd42e6",
    bot: "#be2020",
    command: "#7418a3",
    link: "#c084fc",
    process: "#a1a1aa",
    discord: "#6270f0",
    webServer: "#08c48a",
    mute: "#efaa32",
    amongUs: "#602027",
    timestamp: "#f7f7f8",
    divider: "#303034",
    database: "#22d3ee",
    metrics: "#7dd3fc",
    telemetry: "#a78bfa",
    updates: "#86efac",
    embeds: {
        blue: "#4f5cc8",
        red: "#e84d50",
        green: "#5ceb8e",
        orange: "#df9058",
    },
} as const;

export const logModules = {
    Bot: { name: "bot", tint: logTheme.bot } as LogModule,
    Command: { name: "command", tint: logTheme.command } as LogModule,
    Link: { name: "link", tint: logTheme.link } as LogModule,
    Discord: { name: "discord", tint: logTheme.discord } as LogModule,
    WebServer: { name: "web-server", tint: logTheme.webServer } as LogModule,
    Mute: { name: "mute", tint: logTheme.mute } as LogModule,
    AmongUs: { name: "among-us", tint: logTheme.amongUs } as LogModule,
    Database: { name: "database", tint: logTheme.database } as LogModule,
    Metrics: { name: "metrics", tint: logTheme.metrics } as LogModule,
    Telemetry: { name: "telemetry", tint: logTheme.telemetry } as LogModule,
    Updates: { name: "updates", tint: logTheme.updates } as LogModule,
};

const levelLabels: Record<LogLevel, string> = {
    info: "INFO",
    warn: "WARN",
    error: "ERROR",
    success: "OK",
    debug: "DEBUG",
};

export const LOG_LEVEL_SETTINGS = ["debug", "info", "warn", "error"] as const;
export type LogLevelSetting = (typeof LOG_LEVEL_SETTINGS)[number];

const levelRank: Record<LogLevel, number> = { debug: 0, info: 1, success: 1, warn: 2, error: 3 };

const labelWidth = 5;
const moduleWidth = 10;
const processWidth = 7;
const MASK_VISIBLE_CHARS = 2;
const MASK_MIN_LENGTH = 5;

function getTimestamp(): string {
    const now = new Date();
    const twoDigits = (value: number) => value.toString().padStart(2, "0");

    return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())} ${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}:${twoDigits(now.getSeconds())}`;
}

function fitColumn(value: string, width: number): string {
    return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

/** "cluster-3" becomes "c3" so the process column stays narrow; "gateway" stays as it is. */
function shortProcessName(processName: string): string {
    return processName.replace(/^cluster-/, "c");
}

function formatLine(level: LogLevel, module: LogModule, message: string): string {
    const time = chalk.hex(logTheme.timestamp)(getTimestamp());
    const label = chalk.hex(logTheme[level])(fitColumn(levelLabels[level], labelWidth));
    const source = chalk.hex(module.tint)(fitColumn(module.name, moduleWidth));
    const processLabel = chalk.hex(logTheme.process)(fitColumn(shortProcessName(activeProcess), processWidth));
    const divider = chalk.hex(logTheme.divider)("│");

    return `${time} ${divider} ${label} ${divider} ${source} ${divider} ${processLabel} ${divider} ${message}`;
}

export type LogFormat = "pretty" | "json";

function isLogLevelSetting(value: string): value is LogLevelSetting {
    return (LOG_LEVEL_SETTINGS as readonly string[]).includes(value);
}

/** The LOG_LEVEL environment variable wins over the config, so debug output needs no config change. */
export function resolveLogLevel(
    configured: LogLevelSetting,
    env: Record<string, string | undefined> = process.env,
): LogLevelSetting {
    const fromEnv = env.LOG_LEVEL?.trim().toLowerCase();
    return fromEnv && isLogLevelSetting(fromEnv) ? fromEnv : configured;
}

// Lines written before configureLogger runs (config loading, import-time failures) still name their process.
let activeFormat: LogFormat = "pretty";
let activeProcess = process.env.CLUSTER_ID === undefined ? "gateway" : `cluster-${process.env.CLUSTER_ID}`;
let activeLevel: LogLevelSetting = resolveLogLevel("info");

export function configureLogger(opts: { format: LogFormat; processName: string; level?: LogLevelSetting }): void {
    activeFormat = opts.format;
    activeProcess = opts.processName;
    activeLevel = opts.level ?? "info";
}

/** Hides a link code or quick chat phrase in a log line; the first characters are enough to tell codes apart. */
export function maskForLog(value: string): string {
    if (value.length < MASK_MIN_LENGTH) return "*".repeat(value.length);
    return value.slice(0, MASK_VISIBLE_CHARS) + "*".repeat(value.length - MASK_VISIBLE_CHARS);
}

const SENSITIVE_KEY = /token|secret|authorization|password|cookie/i;
const URL_TOKEN = /(\/(?:webhooks|interactions)\/\d+\/)[\w.-]+/g;
const BEARER = /\b(Bearer|Bot)\s+(?=[\w.~+/=-]*\d)[\w.~+/=-]{16,}/gi;
const BASIC = /\b(Basic)\s+(?=[A-Za-z0-9+/]*[\d+/=])[A-Za-z0-9+/]{8,}={0,2}/g;
const KEY_VALUE = /(authorization|token|secret)(["']?\s*[:=]\s*["']?)(?:(?:Bearer|Bot|Basic)\s+)?[^\s,;"'}]+/gi;

function redact(text: string): string {
    return text
        .replace(URL_TOKEN, "$1[redacted]")
        .replace(BEARER, "$1 [redacted]")
        .replace(BASIC, "$1 [redacted]")
        .replace(KEY_VALUE, "$1$2[redacted]");
}

function errorText(error: Error): string {
    const code = (error as { code?: unknown }).code;
    const base = error.stack ?? `${error.name}: ${error.message}`;
    return code === undefined ? base : `${base}\ncode: ${String(code)}`;
}

function jsonContext(context: unknown): string {
    if (context instanceof Error) return redact(errorText(context));
    if (typeof context === "string") return redact(context);

    try {
        const seen = new WeakSet<object>();
        const text = JSON.stringify(context, (key, value: unknown) => {
            if (SENSITIVE_KEY.test(key)) return "[redacted]";
            if (typeof value === "bigint") return value.toString();
            if (value instanceof Error) return errorText(value);
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) return "[Circular]";
                seen.add(value);
            }
            return value;
        });
        return redact(text ?? "undefined");
    } catch {
        return "[unserialisable]";
    }
}

function safeText(value: unknown): string {
    try {
        return String(value);
    } catch {
        return "[unserialisable]";
    }
}

function writeJson(level: LogLevel, module: LogModule, message: string, context?: unknown): void {
    try {
        const entry: Record<string, string> = {
            time: new Date().toISOString(),
            level,
            module: module.name,
            process: activeProcess,
            msg: redact(safeText(message)),
        };
        if (context !== undefined) entry.error = jsonContext(context);

        process.stdout.write(`${JSON.stringify(entry)}\n`);
    } catch {
        // a logging fault must never reach the caller
    }
}

function write(level: LogLevel, module: LogModule, message: string, context?: unknown): void {
    if (levelRank[level] < levelRank[activeLevel]) return;
    if (activeFormat === "json") {
        writeJson(level, module, message, context);
        return;
    }

    process.stdout.write(`${formatLine(level, module, message)}\n`);
    if (context !== undefined) {
        process.stderr.write(`${stringifyContext(context)}\n`);
    }
}

function stringifyContext(context: unknown): string {
    if (context instanceof Error) {
        return context.stack ?? context.message;
    }

    if (typeof context === "string") {
        return context;
    }

    try {
        return JSON.stringify(context, null, 2);
    } catch {
        return String(context);
    }
}

export const logger = {
    info: (module: LogModule, message: string) => write("info", module, message),
    warn: (module: LogModule, message: string) => write("warn", module, message),
    success: (module: LogModule, message: string) => write("success", module, message),
    debug: (module: LogModule, message: string) => write("debug", module, message),
    error: (module: LogModule, message: string, context?: unknown) => write("error", module, message, context),
};
