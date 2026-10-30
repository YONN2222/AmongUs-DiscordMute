import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLogger, logger, logModules, maskForLog, resolveLogLevel } from "../../src/Logging/Logger";

const ESC = String.fromCharCode(27);

function capture() {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        out.push(String(chunk));
        return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        err.push(String(chunk));
        return true;
    });
    return { out, err };
}

afterEach(() => {
    configureLogger({ format: "pretty", processName: "gateway" });
    vi.restoreAllMocks();
});

describe("logger json format", () => {
    it("json line has all fields and parses", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        logger.info(logModules.Metrics, "hello");

        expect(out).toHaveLength(1);
        expect(out[0]?.endsWith("\n")).toBe(true);
        const parsed = JSON.parse(out[0] ?? "");
        expect(parsed).toMatchObject({ level: "info", module: "metrics", process: "gateway", msg: "hello" });
        expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
        expect(parsed.error).toBeUndefined();
    });

    it("error context is in the same json line and nothing goes to stderr", () => {
        const { out, err } = capture();
        configureLogger({ format: "json", processName: "cluster-2" });
        logger.error(logModules.Bot, "failed", new Error("boom"));

        expect(err).toHaveLength(0);
        expect(out).toHaveLength(1);
        const parsed = JSON.parse(out[0] ?? "");
        expect(parsed.level).toBe("error");
        expect(parsed.process).toBe("cluster-2");
        expect(parsed.error).toContain("boom");
    });

    it("does not serialise tokens from error contexts", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        const error = Object.assign(
            new Error("POST https://discord.com/api/v10/webhooks/123/SECRETtoken_-x/messages/@original failed"),
            {
                code: 50027,
                headers: { Authorization: "Bot abc.def" },
            },
        );
        logger.error(logModules.Discord, "reply failed", error);
        logger.error(logModules.Discord, "ctx", { token: "SECRET", nested: { authorization: "Bot x" }, ok: 1 });

        const text = out.join("");
        expect(text).toContain("webhooks/123/[redacted]");
        expect(text).toContain("[redacted]");
        expect(text).not.toContain("SECRETtoken");
        expect(text).not.toContain("Bot abc");
        expect(text).not.toContain('"SECRET"');
        expect(text).not.toContain("Bot x");
        expect(text).toContain("50027");
    });

    it("json output has no ANSI escape codes", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway", level: "debug" });
        logger.success(logModules.Bot, "ok");
        logger.warn(logModules.Updates, "warn");
        logger.debug(logModules.Telemetry, "dbg");

        expect(out).toHaveLength(3);
        for (const line of out) expect(line).not.toContain(ESC);
    });

    it("message with newlines and quotes stays one valid json line", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        logger.info(logModules.Bot, 'line1\nline2 "quoted"');

        expect(out[0]?.trimEnd().includes("\n")).toBe(false);
        expect(JSON.parse(out[0] ?? "").msg).toBe('line1\nline2 "quoted"');
    });

    it("pretty mode is unchanged by default", () => {
        const { out, err } = capture();
        logger.info(logModules.Bot, "hello");
        logger.error(logModules.Bot, "bad", "ctx");

        expect(out[0]).toContain("│");
        expect(out[0]).toContain("bot");
        expect(out[0]).toContain("hello");
        expect(err).toEqual(["ctx\n"]);
    });
});

describe("logger json redaction and safety", () => {
    function lastEntry(out: string[]) {
        expect(out).toHaveLength(1);
        return JSON.parse(out[0] ?? "") as { msg: string; error?: string };
    }

    it("leaves ordinary text alone and redacts token-shaped values", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        logger.info(logModules.Bot, "Bot is ready");
        logger.info(logModules.Bot, "Bot started");
        logger.info(logModules.Bot, "auth Bot MTIzNDU2Nzg5.abc.def123 end");
        logger.info(logModules.Bot, "auth bearer abcdef1234567890xyz end");
        logger.info(logModules.Bot, "auth Basic dXNlcjpwYXNzd29yZA== end");

        const msgs = out.map((line) => JSON.parse(line).msg as string);
        expect(msgs[0]).toBe("Bot is ready");
        expect(msgs[1]).toBe("Bot started");
        expect(msgs[2]).toBe("auth Bot [redacted] end");
        expect(msgs[3]).toBe("auth bearer [redacted] end");
        expect(msgs[4]).toBe("auth Basic [redacted] end");
    });

    it("redacts interaction urls and key-value secrets in strings", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        logger.error(logModules.Discord, "m", "POST /interactions/123456/aW50ZXJhY3Rpb25Ub2tlbg/callback failed");
        const first = lastEntry(out);
        expect(first.error).toContain("/interactions/123456/[redacted]/callback");
        expect(first.error).not.toContain("aW50ZXJhY3Rpb25Ub2tlbg");

        out.length = 0;
        logger.error(logModules.Discord, "m", 'config authorization: Bot shortsecret, token="abc123" secret=xyz');
        const second = lastEntry(out);
        expect(second.error).not.toContain("shortsecret");
        expect(second.error).not.toContain("abc123");
        expect(second.error).not.toContain("xyz");
        expect(second.error).toContain("[redacted]");
    });

    it("keeps non-sensitive keys and redacts sensitive keys at depth", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        logger.error(logModules.Bot, "m", { ok: 1, a: { b: [{ c: { apiToken: "hidden-value" } }] } });

        const error = lastEntry(out).error ?? "";
        expect(error).toContain('"ok":1');
        expect(error).toContain("[redacted]");
        expect(error).not.toContain("hidden-value");
    });

    it("survives circular, bigint and null-prototype contexts", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        const circular: Record<string, unknown> = { name: "loop" };
        circular.self = circular;
        logger.error(logModules.Bot, "m", circular);
        logger.error(logModules.Bot, "m", { big: 12345678901234567890n });
        logger.error(logModules.Bot, "m", Object.create(null));
        logger.error(logModules.Bot, "m", {
            toString() {
                throw new Error("nope");
            },
        });

        expect(out).toHaveLength(4);
        const entries = out.map((line) => JSON.parse(line) as { error: string });
        expect(entries[0]?.error).toContain("[Circular]");
        expect(entries[0]?.error).toContain("loop");
        expect(entries[1]?.error).toContain("12345678901234567890");
        expect(entries[2]?.error).toBe("{}");
        expect(typeof entries[3]?.error).toBe("string");
    });

    it("never throws and coerces non-string messages", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        expect(() => logger.info(logModules.Bot, undefined as unknown as string)).not.toThrow();
        expect(() => logger.info(logModules.Bot, Object.create(null) as string)).not.toThrow();
        expect(out.length).toBeGreaterThanOrEqual(1);
        expect(JSON.parse(out[0] ?? "").msg).toBe("undefined");
    });
});

const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function plain(line: string | undefined): string {
    return (line ?? "").replace(ANSI, "").trimEnd();
}

describe("logger pretty format", () => {
    it("writes time, level, module, process and message in aligned columns", () => {
        const { out } = capture();
        configureLogger({ format: "pretty", processName: "cluster-2" });
        logger.success(logModules.Discord, "Logged in as DiscordMute#0001");
        configureLogger({ format: "pretty", processName: "gateway" });
        logger.warn(logModules.WebServer, "Plugin disconnected");

        expect(plain(out[0])).toMatch(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} │ OK {4}│ discord {4}│ c2 {6}│ Logged in as DiscordMute#0001$/,
        );
        expect(plain(out[1])).toMatch(/│ WARN {2}│ web-server │ gateway │ Plugin disconnected$/);
    });

    it("still matches the level and module pattern log shippers use", () => {
        const { out } = capture();
        configureLogger({ format: "pretty", processName: "cluster-0" });
        logger.info(logModules.Link, "hello");

        const shipperPattern = new RegExp(
            `^(?:${ESC}\\[[0-9;]*m)*\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:${ESC}\\[[0-9;]*m|[ │])+(?<level>INFO|WARN|ERROR|OK|DEBUG)(?:${ESC}\\[[0-9;]*m|[ │])+(?<module>[a-z][a-z-]*)(?:${ESC}\\[[0-9;]*m|[ │])+(?<process>gateway|c\\d+)`,
        );
        const match = shipperPattern.exec(out[0] ?? "");
        expect(match?.groups).toMatchObject({ level: "INFO", module: "link", process: "c0" });
    });
});

describe("logger level", () => {
    it("hides debug lines at the default info level", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway" });
        logger.debug(logModules.Bot, "noise");
        logger.info(logModules.Bot, "kept");

        expect(out.map((line) => JSON.parse(line).msg)).toEqual(["kept"]);
    });

    it("shows debug lines at debug level and only warnings and errors at warn level", () => {
        const { out } = capture();
        configureLogger({ format: "json", processName: "gateway", level: "debug" });
        logger.debug(logModules.Bot, "debug");
        configureLogger({ format: "json", processName: "gateway", level: "warn" });
        logger.info(logModules.Bot, "info");
        logger.success(logModules.Bot, "success");
        logger.warn(logModules.Bot, "warn");
        logger.error(logModules.Bot, "error");

        expect(out.map((line) => JSON.parse(line).msg)).toEqual(["debug", "warn", "error"]);
    });

    it("lets LOG_LEVEL override the configured level and ignores unknown values", () => {
        expect(resolveLogLevel("info", { LOG_LEVEL: "debug" })).toBe("debug");
        expect(resolveLogLevel("warn", { LOG_LEVEL: "DEBUG" })).toBe("debug");
        expect(resolveLogLevel("warn", { LOG_LEVEL: "loud" })).toBe("warn");
        expect(resolveLogLevel("info", {})).toBe("info");
    });
});

describe("maskForLog", () => {
    it("keeps only the first two characters of a link code or quick chat phrase", () => {
        expect(maskForLog("link-VFD8")).toBe("li*******");
        expect(maskForLog("3536-3542")).toBe("35*******");
        expect(maskForLog("ab")).toBe("**");
    });
});
