import { logger, logModules } from "../Logging/logger";
import type { ProcessSnapshot } from "../Metrics/MetricsCollector";
import { BOT_VERSION } from "../version";
import { HOSTED_AUTH_HEADER, RETRYABLE, TELEMETRY_PATH } from "./contract/contract";
import type { TelemetryMode, TelemetryPacket } from "./contract/schema";
import type { TelemetryBuilder } from "./TelemetryBuilder";

export const TELEMETRY_URL = `https://mute.yonn2222.com${TELEMETRY_PATH}`;
export const TELEMETRY_INTERVAL_MS = 5 * 60 * 1000;
export const TELEMETRY_TIMEOUT_MS = 10000;
export const MAX_PACKET_AGE_MS = 60 * 60 * 1000;

export type TickOutcome = "accepted" | "duplicate" | "retry-later" | "dropped" | "expired";

export interface TelemetryTarget {
    url: string;
    authorization?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function acceptableOverride(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    try {
        const url = new URL(raw);
        const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
        return url.protocol === "https:" || local ? raw : undefined;
    } catch {
        return undefined;
    }
}

export function telemetryTarget(opts: {
    disabled: boolean;
    compiled: boolean;
    mode: TelemetryMode;
    env: Record<string, string | undefined>;
}): TelemetryTarget | null {
    if (opts.disabled) return null;
    const optedIn = opts.env.DISCORDMUTE_TELEMETRY === "1";
    if (!opts.compiled && !optedIn) return null;

    const url = (optedIn ? acceptableOverride(opts.env.DISCORDMUTE_TELEMETRY_URL) : undefined) ?? TELEMETRY_URL;
    if (opts.mode !== "hosted") return { url };

    const token = opts.env.HOSTED_TELEMETRY_TOKEN;
    if (!token) {
        logger.warn(
            logModules.Telemetry,
            "HOSTED_TELEMETRY_TOKEN is not set, telemetry stays off (it would be refused)",
        );
        return null;
    }
    return { url, authorization: `Bearer ${token}` };
}

interface ServiceDeps {
    target: TelemetryTarget;
    fetch: typeof fetch;
    collect: () => Promise<ProcessSnapshot[]>;
    builder: TelemetryBuilder;
    intervalMs?: number;
    now?: () => number;
}

type Pending = { packet: TelemetryPacket; builtAt: number };

async function responseError(response: Response): Promise<string | undefined> {
    try {
        const body: unknown = await response.json();
        const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
        return typeof error === "string" ? error : undefined;
    } catch {
        return undefined;
    }
}

export class TelemetryService {
    private timer: ReturnType<typeof setInterval> | undefined;
    private pending: Pending | undefined;
    private inFlight: Promise<TickOutcome> | undefined;
    private abort: AbortController | undefined;
    private warnedUnauthorized = false;

    constructor(private readonly deps: ServiceDeps) {}

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? TELEMETRY_INTERVAL_MS);
        this.timer.unref();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.abort?.abort();
    }

    tick(): Promise<TickOutcome> {
        this.inFlight ??= this.run().finally(() => {
            this.inFlight = undefined;
        });
        return this.inFlight;
    }

    private async run(): Promise<TickOutcome> {
        const now = (this.deps.now ?? Date.now)();
        if (this.pending && now - this.pending.builtAt > MAX_PACKET_AGE_MS) {
            this.pending = undefined;
            try {
                this.deps.builder.resetBaseline(await this.deps.collect());
            } catch (error) {
                logger.debug(logModules.Telemetry, `Telemetry baseline reset failed: ${errorMessage(error)}`);
            }
            logger.debug(logModules.Telemetry, "Dropped an unsent telemetry packet older than one hour");
            return "expired";
        }

        if (!this.pending) {
            try {
                const packet = await this.deps.builder.build(await this.deps.collect());
                this.pending = { packet, builtAt: now };
            } catch (error) {
                logger.debug(logModules.Telemetry, `Telemetry packet not built: ${errorMessage(error)}`);
                return "retry-later";
            }
        }
        return this.send(this.pending);
    }

    private async send(pending: Pending): Promise<TickOutcome> {
        const { target } = this.deps;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": `DiscordMute-Bot/${BOT_VERSION}`,
        };
        if (target.authorization) headers[HOSTED_AUTH_HEADER] = target.authorization;

        let response: Response;
        try {
            response = await this.post(JSON.stringify(pending.packet), headers);
        } catch (error) {
            logger.debug(logModules.Telemetry, `Telemetry request failed, will retry: ${errorMessage(error)}`);
            return "retry-later";
        }

        if (response.status === 202 || response.status === 200) {
            this.pending = undefined;
            return response.status === 202 ? "accepted" : "duplicate";
        }

        const error = await responseError(response);
        const retryable =
            error !== undefined ? RETRYABLE.has(error) : response.status === 429 || response.status >= 500;
        if (retryable) {
            logger.debug(logModules.Telemetry, `Telemetry refused with ${response.status}, will retry`);
            return "retry-later";
        }

        this.pending = undefined;
        if (response.status === 401 && target.authorization && !this.warnedUnauthorized) {
            this.warnedUnauthorized = true;
            logger.warn(logModules.Telemetry, "Telemetry token was refused (401), check HOSTED_TELEMETRY_TOKEN");
        } else {
            logger.debug(logModules.Telemetry, `Telemetry packet dropped (${response.status} ${error ?? "no error"})`);
        }
        return "dropped";
    }

    /** Races the request against its own timer so a fetch that ignores the abort signal cannot hang a tick. */
    private async post(body: string, headers: Record<string, string>): Promise<Response> {
        const controller = new AbortController();
        this.abort = controller;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const aborted = new Promise<never>((_, reject) => {
            const fail = () => reject(new Error("telemetry request timed out or was cancelled"));
            controller.signal.addEventListener("abort", fail, { once: true });
            timer = setTimeout(() => {
                controller.abort();
                fail();
            }, TELEMETRY_TIMEOUT_MS);
            timer.unref();
        });
        try {
            return await Promise.race([
                this.deps.fetch(this.deps.target.url, { method: "POST", headers, body, signal: controller.signal }),
                aborted,
            ]);
        } finally {
            clearTimeout(timer);
            if (this.abort === controller) this.abort = undefined;
        }
    }
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
