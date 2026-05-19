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
    discord: "#6270f0",
    webServer: "#08c48a",
    mute: "#efaa32",
    amongUs: "#602027",
    timestamp: "#f7f7f8",
    divider: "#303034",
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
    Discord: { name: "discord", tint: logTheme.discord } as LogModule,
    WebServer: { name: "web-server", tint: logTheme.webServer } as LogModule,
    Mute: { name: "mute", tint: logTheme.mute } as LogModule,
    AmongUs: { name: "among-us", tint: logTheme.amongUs } as LogModule,
};

const levelLabels: Record<LogLevel, string> = {
    info: "INFO",
    warn: "WARN",
    error: "ERROR",
    success: "OK",
    debug: "DEBUG",
};

const labelWidth = 5;
const moduleWidth = 10;

function getTimestamp(): string {
    const now = new Date();
    const twoDigits = (value: number) => value.toString().padStart(2, "0");

    return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())} ${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}:${twoDigits(now.getSeconds())}`;
}

function fit(value: string, width: number): string {
    return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

function formatLine(level: LogLevel, module: LogModule, message: string): string {
    const time = chalk.hex(logTheme.timestamp)(getTimestamp());
    const label = chalk.hex(logTheme[level])(fit(levelLabels[level], labelWidth));
    const source = chalk.hex(module.tint)(fit(module.name, moduleWidth));
    const divider = chalk.hex(logTheme.divider)("│");

    return `${time} ${divider} ${label} ${divider} ${source} ${divider} ${message}`;
}

function write(level: LogLevel, module: LogModule, message: string): void {
    process.stdout.write(`${formatLine(level, module, message)}\n`);
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
    error: (module: LogModule, message: string, context?: unknown) => {
        write("error", module, message);

        if (context !== undefined) {
            process.stderr.write(`${stringifyContext(context)}\n`);
        }
    },
};
