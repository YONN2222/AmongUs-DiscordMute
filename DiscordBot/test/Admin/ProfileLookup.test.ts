import { RateLimitError } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProfileLookup, createProfileRest, type ProfileRest } from "../../src/Admin/ProfileLookup";
import { logger } from "../../src/Logging/Logger";

const USER = "123456789012345678";
const OTHER = "223456789012345678";
const TTL_MS = 60_000;
const TIMEOUT_MS = 3_000;

function httpError(status: number): Error {
    return Object.assign(new Error(`HTTP ${status}`), { status });
}

function rateLimited(): RateLimitError {
    return new RateLimitError({
        timeToReset: 5_000,
        limit: 1,
        method: "GET",
        hash: "hash",
        url: `https://discord.com/api/v10/users/${USER}`,
        route: "/users/:id",
        majorParameter: "global",
        global: false,
        retryAfter: 5_000,
        sublimitTimeout: 0,
        scope: "user",
    });
}

function idOf(route: string): string {
    return route.split("/").pop() ?? "";
}

function rawUser(id: string, overrides: Record<string, unknown> = {}) {
    return { id, username: `crewmate${id.slice(-3)}`, global_name: "Red Crewmate", avatar: "abc123", ...overrides };
}

function fakeRest(answer: (route: string) => Promise<unknown> = async (route) => rawUser(idOf(route))) {
    return { get: vi.fn((route: string) => answer(route)) } satisfies ProfileRest;
}

function never(): Promise<never> {
    return new Promise(() => {
        /* never answers */
    });
}

/** Lets every already settled promise run its callbacks. */
async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
}

describe("profile lookup", () => {
    let clock: number;
    let logs: unknown[][];

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        clock = 1_000_000;
        logs = [];
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
                logs.push(args);
            });
        }
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const lookupWith = (rest: ProfileRest, options: { maxEntries?: number; concurrency?: number } = {}) =>
        createProfileLookup({ rest, now: () => clock, ttlMs: TTL_MS, timeoutMs: TIMEOUT_MS, ...options });

    it("maps the Discord user and builds the avatar url", async () => {
        const rest = fakeRest(async () => rawUser(USER));
        const animated = fakeRest(async () => rawUser(OTHER, { avatar: "a_moving", global_name: null }));

        expect(await lookupWith(rest).lookup(USER)).toEqual({
            status: "found",
            profile: {
                id: USER,
                username: "crewmate678",
                globalName: "Red Crewmate",
                avatarUrl: `https://cdn.discordapp.com/avatars/${USER}/abc123.png?size=128`,
            },
        });
        expect(rest.get).toHaveBeenCalledWith(`/users/${USER}`, expect.objectContaining({ signal: expect.anything() }));
        expect(await lookupWith(animated).lookup(OTHER)).toMatchObject({
            profile: {
                globalName: null,
                avatarUrl: `https://cdn.discordapp.com/avatars/${OTHER}/a_moving.gif?size=128`,
            },
        });
    });

    it("a user without an avatar has no avatar url", async () => {
        const rest = fakeRest(async () => rawUser(USER, { avatar: null }));

        expect(await lookupWith(rest).lookup(USER)).toMatchObject({ profile: { avatarUrl: null } });
    });

    it("answers from the cache within the ttl and asks Discord again after it", async () => {
        const rest = fakeRest();
        const lookup = lookupWith(rest);

        await lookup.lookup(USER);
        clock += TTL_MS - 1;
        await lookup.lookup(USER);
        expect(rest.get).toHaveBeenCalledTimes(1);

        clock += 2;
        await lookup.lookup(USER);
        expect(rest.get).toHaveBeenCalledTimes(2);
    });

    it("caches an unknown user like a found one", async () => {
        const rest = fakeRest(async () => {
            throw httpError(404);
        });
        const lookup = lookupWith(rest);

        expect(await lookup.lookup(USER)).toEqual({ status: "unknown" });
        expect(await lookup.lookupMany([USER])).toEqual({ [USER]: null });
        expect(rest.get).toHaveBeenCalledTimes(1);
    });

    it("a server error gives no profile and is asked again next time", async () => {
        let call = 0;
        const rest = fakeRest(async () => {
            call += 1;
            if (call === 1) throw httpError(503);
            return rawUser(USER);
        });
        const lookup = lookupWith(rest);

        expect(await lookup.lookup(USER)).toEqual({ status: "failed" });
        expect(await lookup.lookup(USER)).toMatchObject({ status: "found" });
        expect(rest.get).toHaveBeenCalledTimes(2);
    });

    it("a lookup that runs past its budget fails and is asked again next time", async () => {
        let call = 0;
        const rest = fakeRest(async () => {
            call += 1;
            return call === 1 ? never() : rawUser(USER);
        });
        const lookup = lookupWith(rest);

        const hung = lookup.lookup(USER);
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
        let finished = false;
        void hung.then(() => {
            finished = true;
        });
        await settle();
        expect(finished).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(await hung).toEqual({ status: "failed" });
        expect(await lookup.lookup(USER)).toMatchObject({ status: "found" });
        expect(JSON.stringify(logs)).toContain("timed out");
    });

    it("the budget also covers the wait for a free slot", async () => {
        const rest = fakeRest(() => never());
        const lookup = lookupWith(rest, { concurrency: 1 });

        const first = lookup.lookup(USER);
        const waiting = lookup.lookup(OTHER);
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

        expect(await waiting).toEqual({ status: "failed" });
        expect(await first).toEqual({ status: "failed" });
        expect(rest.get).toHaveBeenCalledTimes(1);
    });

    it("a rate limit fails at once, is logged as 429 and is not cached", async () => {
        let call = 0;
        const rest = fakeRest(async () => {
            call += 1;
            if (call === 1) throw rateLimited();
            return rawUser(USER);
        });
        const lookup = lookupWith(rest);

        expect(await lookup.lookup(USER)).toEqual({ status: "failed" });
        expect(JSON.stringify(logs)).toContain("HTTP 429");
        expect(await lookup.lookup(USER)).toMatchObject({ status: "found" });
    });

    it("the profile REST client rejects rate limits on the user route instead of waiting", () => {
        const rest = createProfileRest("test-token");

        expect(rest.options.rejectOnRateLimit).toEqual(["/users"]);
        expect(rest.options.version).toBe("10");
    });

    it("an answer that is not a Discord user counts as failed", async () => {
        const rest = fakeRest(async () => ({ id: USER }));

        expect(await lookupWith(rest).lookup(USER)).toEqual({ status: "failed" });
    });

    it("concurrent lookups of the same user share one request", async () => {
        let answer: (value: unknown) => void = () => {};
        const rest = fakeRest(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        const lookup = lookupWith(rest);

        const first = lookup.lookup(USER);
        const second = lookup.lookup(USER);
        await settle();
        answer(rawUser(USER));

        expect(await first).toEqual(await second);
        expect(rest.get).toHaveBeenCalledTimes(1);
    });

    it("never asks Discord for more users at once than allowed", async () => {
        const pending: (() => void)[] = [];
        const rest = fakeRest(
            (route) =>
                new Promise((resolve) => {
                    pending.push(() => resolve(rawUser(idOf(route))));
                }),
        );
        const ids = Array.from({ length: 5 }, (_, index) => `1234567890123456${String(index).padStart(2, "0")}`);

        const profiles = lookupWith(rest, { concurrency: 2 }).lookupMany(ids);
        await settle();
        expect(rest.get).toHaveBeenCalledTimes(2);

        while (pending.length > 0) {
            pending.shift()?.();
            await settle();
            expect(pending.length).toBeLessThanOrEqual(2);
        }

        const result = await profiles;
        expect(rest.get).toHaveBeenCalledTimes(5);
        expect(Object.values(result).every((profile) => profile !== null)).toBe(true);
    });

    it("evicts the oldest entry once the cache is full", async () => {
        const rest = fakeRest();
        const lookup = lookupWith(rest, { maxEntries: 2 });
        const third = "323456789012345678";

        await lookup.lookup(USER);
        await lookup.lookup(OTHER);
        await lookup.lookup(third);
        await lookup.lookupMany([OTHER, third]);
        expect(rest.get).toHaveBeenCalledTimes(3);

        await lookup.lookup(USER);
        expect(rest.get).toHaveBeenCalledTimes(4);
    });

    it("logs the outcome and status, never a username or avatar", async () => {
        let call = 0;
        const rest = fakeRest(async (route) => {
            call += 1;
            if (call === 2) throw httpError(500);
            return rawUser(idOf(route));
        });
        const lookup = lookupWith(rest);

        await lookup.lookup(USER);
        await lookup.lookup(OTHER);

        const logged = JSON.stringify(logs);
        expect(logged).toContain("500");
        expect(logged).not.toMatch(/crewmate|Red Crewmate|abc123/);
    });
});
