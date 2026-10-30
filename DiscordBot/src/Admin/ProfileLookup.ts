import { RateLimitError, REST, Routes } from "discord.js";
import { z } from "zod";
import { logger, logModules } from "../Logging/Logger";
import type { DiscordProfile } from "./Contract";

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 5_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 3_000;
const AVATAR_SIZE = 128;
const ANIMATED_AVATAR_PREFIX = "a_";
const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;
const DISCORD_API_VERSION = "10";
const USER_ROUTE_PREFIX = "/users";

/** The one call this module makes; discord.js's REST client fits it. */
export interface ProfileRest {
    get(route: `/${string}`, options: { signal: AbortSignal }): Promise<unknown>;
}

/**
 * A REST client used only for profile lookups. A rate limit rejects at once instead of sleeping, because the
 * client's rate limit sleeps ignore the abort signal and would hold a lookup slot past its time budget.
 */
export function createProfileRest(botToken: string): REST {
    return new REST({ version: DISCORD_API_VERSION, rejectOnRateLimit: [USER_ROUTE_PREFIX] }).setToken(botToken);
}

export type ProfileLookupResult =
    | { status: "found"; profile: DiscordProfile }
    | { status: "unknown" }
    /** Discord could not be asked in time or answered with an error; nothing is cached. */
    | { status: "failed" };

export interface ProfileLookup {
    lookup(userId: string): Promise<ProfileLookupResult>;
    /** Null for users Discord does not know and for lookups that failed. */
    lookupMany(userIds: string[]): Promise<Record<string, DiscordProfile | null>>;
}

export interface ProfileLookupOptions {
    rest: ProfileRest;
    now: () => number;
    ttlMs?: number;
    maxEntries?: number;
    concurrency?: number;
    timeoutMs?: number;
}

type CachedResult = Exclude<ProfileLookupResult, { status: "failed" }>;

const discordUserSchema = z.object({
    id: z.string(),
    username: z.string(),
    global_name: z.string().nullish(),
    avatar: z.string().nullable(),
});

function toProfile(user: z.infer<typeof discordUserSchema>): DiscordProfile {
    const extension = user.avatar?.startsWith(ANIMATED_AVATAR_PREFIX) ? "gif" : "png";
    return {
        id: user.id,
        username: user.username,
        globalName: user.global_name ?? null,
        avatarUrl: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${AVATAR_SIZE}`
            : null,
    };
}

function httpStatusOf(error: unknown): number | null {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : null;
}

/** Runs at most `max` tasks at once; a finished task hands its slot straight to the next waiting one. */
function createLimiter(max: number) {
    let active = 0;
    const waiting: (() => void)[] = [];
    return async function run<T>(task: () => Promise<T>): Promise<T> {
        if (active < max) active += 1;
        else await new Promise<void>((resolve) => waiting.push(resolve));
        try {
            return await task();
        } finally {
            const next = waiting.shift();
            if (next) next();
            else active -= 1;
        }
    };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

/**
 * Looks up public Discord profiles for the admin API. Results live only in this in-memory cache for `ttlMs`;
 * nothing is written to the database or disk, and logs never carry a username or avatar.
 */
export function createProfileLookup({
    rest,
    now,
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
}: ProfileLookupOptions): ProfileLookup {
    const cache = new Map<string, { result: CachedResult; expiresAt: number }>();
    const inFlight = new Map<string, Promise<ProfileLookupResult>>();
    const limit = createLimiter(concurrency);

    function cached(userId: string): CachedResult | null {
        const entry = cache.get(userId);
        if (!entry) return null;
        if (entry.expiresAt > now()) return entry.result;
        cache.delete(userId);
        return null;
    }

    function remember(userId: string, result: CachedResult): void {
        cache.delete(userId);
        if (cache.size >= maxEntries) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(userId, { result, expiresAt: now() + ttlMs });
    }

    async function askDiscord(userId: string): Promise<ProfileLookupResult> {
        // The budget covers the wait for a free slot as well as Discord's answer.
        const budget = new AbortController();
        const timer = setTimeout(() => budget.abort(new Error("Discord profile lookup timed out")), timeoutMs);
        const { signal } = budget;
        try {
            const raw = await Promise.race([
                limit(() => {
                    signal.throwIfAborted();
                    return rest.get(Routes.user(userId), { signal });
                }),
                rejectWhenAborted(signal),
            ]);
            const user = discordUserSchema.safeParse(raw);
            if (!user.success) {
                logger.warn(logModules.WebServer, "Discord profile lookup returned an unexpected answer");
                return { status: "failed" };
            }
            const result = { status: "found", profile: toProfile(user.data) } as const;
            remember(userId, result);
            logger.debug(logModules.WebServer, "Discord profile lookup found the user");
            return result;
        } catch (error) {
            const status = error instanceof RateLimitError ? TOO_MANY_REQUESTS : httpStatusOf(error);
            if (status === NOT_FOUND) {
                remember(userId, { status: "unknown" });
                logger.debug(logModules.WebServer, "Discord profile lookup: unknown user (HTTP 404)");
                return { status: "unknown" };
            }
            const reason = signal.aborted ? "timed out" : `failed (HTTP ${status ?? "none"})`;
            logger.warn(logModules.WebServer, `Discord profile lookup ${reason}`);
            return { status: "failed" };
        } finally {
            clearTimeout(timer);
        }
    }

    function lookup(userId: string): Promise<ProfileLookupResult> {
        const known = cached(userId);
        if (known) return Promise.resolve(known);
        const pending = inFlight.get(userId);
        if (pending) return pending;
        const request = askDiscord(userId).finally(() => inFlight.delete(userId));
        inFlight.set(userId, request);
        return request;
    }

    async function lookupMany(userIds: string[]): Promise<Record<string, DiscordProfile | null>> {
        const results = await Promise.all(userIds.map(async (userId) => [userId, await lookup(userId)] as const));
        return Object.fromEntries(
            results.map(([userId, result]) => [userId, result.status === "found" ? result.profile : null]),
        );
    }

    return { lookup, lookupMany };
}
