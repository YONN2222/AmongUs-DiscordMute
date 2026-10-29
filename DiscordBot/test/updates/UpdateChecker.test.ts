import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/Logging/logger";
import {
    fetchLatestRelease,
    RELEASES_LATEST_URL,
    startUpdateChecks,
    UPDATE_INTERVAL_MS,
} from "../../src/Updates/UpdateChecker";

const release = { tag_name: "v3.0.1", html_url: "https://github.com/YONN2222/AmongUs-DiscordMute/releases/tag/v3.0.1" };

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

function fakeFetch(respond: () => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return respond();
    }) as typeof fetch;
    return { fn, calls };
}

describe("UpdateChecker", () => {
    beforeEach(() => {
        vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("sends accept, api version and user agent headers and no authorization", async () => {
        const { fn, calls } = fakeFetch(() => jsonResponse(release));
        await fetchLatestRelease(fn, "DiscordMute-Bot/1.0.0");
        const headers = new Headers(calls[0]?.init?.headers);
        expect(calls[0]?.url).toBe(RELEASES_LATEST_URL);
        expect(headers.get("accept")).toBe("application/vnd.github+json");
        expect(headers.get("x-github-api-version")).toBe("2026-03-10");
        expect(headers.get("user-agent")).toBe("DiscordMute-Bot/1.0.0");
        expect(headers.has("authorization")).toBe(false);
    });

    it("notifies with version and release url when newer", async () => {
        const { fn } = fakeFetch(() => jsonResponse(release));
        const notify = vi.fn();
        const checks = startUpdateChecks({ currentVersion: "3.0.0", fetch: fn, notify });
        await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
        expect(notify).toHaveBeenCalledWith({ version: "v3.0.1", url: release.html_url });
        checks.stop();
    });

    it("does not notify when equal or older", async () => {
        const { fn, calls } = fakeFetch(() => jsonResponse(release));
        const notify = vi.fn();
        const equal = startUpdateChecks({ currentVersion: "3.0.1", fetch: fn, notify });
        const older = startUpdateChecks({ currentVersion: "4.0.0", fetch: fn, notify });
        await vi.waitFor(() => expect(calls).toHaveLength(2));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(notify).not.toHaveBeenCalled();
        equal.stop();
        older.stop();
    });

    it("403, 404 and invalid json stay silent at debug level", async () => {
        const responses = [
            () => jsonResponse({}, 403),
            () => jsonResponse({}, 404),
            () => new Response("not json", { status: 200 }),
            () => jsonResponse({ tag_name: "v9.0.0", html_url: "http://evil.example/x" }),
        ];
        for (const respond of responses) {
            const { fn } = fakeFetch(respond);
            expect(await fetchLatestRelease(fn, "ua")).toBeNull();
        }
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("rejecting fetch does not throw and startUpdateChecks returns at once", async () => {
        const { fn, calls } = fakeFetch(() => Promise.reject(new Error("offline")));
        const notify = vi.fn();
        const checks = startUpdateChecks({ currentVersion: "1.0.0", fetch: fn, notify });
        expect(typeof checks.stop).toBe("function");
        await vi.waitFor(() => expect(logger.debug).toHaveBeenCalled());
        expect(calls).toHaveLength(1);
        expect(notify).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        checks.stop();
    });

    it("checks again after 24 h", async () => {
        vi.useFakeTimers();
        const { fn, calls } = fakeFetch(() => jsonResponse(release));
        const checks = startUpdateChecks({ currentVersion: "3.0.1", fetch: fn, notify: vi.fn() });
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
        expect(calls).toHaveLength(2);
        checks.stop();
    });

    it("stop clears the timer", async () => {
        vi.useFakeTimers();
        const { fn, calls } = fakeFetch(() => jsonResponse(release));
        const checks = startUpdateChecks({ currentVersion: "3.0.1", fetch: fn, notify: vi.fn() });
        await vi.advanceTimersByTimeAsync(0);
        checks.stop();
        await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 3);
        expect(calls).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
