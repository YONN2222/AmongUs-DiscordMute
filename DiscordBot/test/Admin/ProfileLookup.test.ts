import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProfileLookup, type ProfileRest } from "../../src/Admin/ProfileLookup";
import { logger } from "../../src/Logging/Logger";

const USER = "123456789012345678";
const OTHER = "223456789012345678";
const TTL_MS = 60_000;

function httpError(status: number): Error {
    return Object.assign(new Error(`HTTP ${status}`), { status });
}

function rawUser(id: string, overrides: Record<string, unknown> = {}) {
    return { id, username: `crewmate${id.slice(-3)}`, global_name: "Red Crewmate", avatar: "abc123", ...overrides };
}

function fakeRest(
    answer: (route: string) => Promise<unknown> = async (route) => rawUser(route.split("/").pop() ?? ""),
) {
    return { get: vi.fn((route: string) => answer(route)) } satisfies ProfileRest;
}

function never(): Promise<never> {
    return new Promise(() => {
        /* never answers */
    });
}

describe("profile lookup", () => {
    let clock: number;
    let logs: unknown[][];

    beforeEach(() => {
        clock = 1_000_000;
        logs = [];
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
                logs.push(args);
            });
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const lookupWith = (rest: ProfileRest, options: { maxEntries?: number; concurrency?: number } = {}) =>
        createProfileLookup({ rest, now: () => clock, ttlMs: TTL_MS, timeoutMs: 50, ...options });

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

    it("a server error or a timeout gives no profile and is asked again next time", async () => {
        let call = 0;
        const rest = fakeRest(async () => {
            call += 1;
            if (call === 1) throw httpError(503);
            if (call === 2) return never();
            return rawUser(USER);
        });
        const lookup = lookupWith(rest);

        expect(await lookup.lookup(USER)).toEqual({ status: "failed" });
        const started = Date.now();
        expect(await lookup.lookup(USER)).toEqual({ status: "failed" });
        expect(Date.now() - started).toBeLessThan(1000);
        expect(await lookup.lookup(USER)).toMatchObject({ status: "found" });
        expect(rest.get).toHaveBeenCalledTimes(3);
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
        answer(rawUser(USER));

        expect(await first).toEqual(await second);
        expect(rest.get).toHaveBeenCalledTimes(1);
    });

    it("never asks Discord for more users at once than allowed", async () => {
        let active = 0;
        let peak = 0;
        const rest = fakeRest(async (route) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return rawUser(route.split("/").pop() ?? "");
        });
        const ids = Array.from({ length: 10 }, (_, index) => `1234567890123456${String(index).padStart(2, "0")}`);

        const profiles = await lookupWith(rest, { concurrency: 2 }).lookupMany(ids);

        expect(peak).toBe(2);
        expect(Object.keys(profiles)).toHaveLength(10);
        expect(Object.values(profiles).every((profile) => profile !== null)).toBe(true);
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
            return rawUser(route.split("/").pop() ?? "");
        });
        const lookup = lookupWith(rest);

        await lookup.lookup(USER);
        await lookup.lookup(OTHER);

        const logged = JSON.stringify(logs);
        expect(logged).toContain("500");
        expect(logged).not.toMatch(/crewmate|Red Crewmate|abc123/);
    });
});
