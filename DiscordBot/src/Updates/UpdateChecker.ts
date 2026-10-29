import { z } from "zod";
import { logger, logModules } from "../Logging/logger";
import { isNewer } from "./versionCompare";

export const RELEASES_LATEST_URL = "https://api.github.com/repos/YONN2222/AmongUs-DiscordMute/releases/latest";
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_TIMEOUT_MS = 10000;

const ReleaseSchema = z.object({
    tag_name: z.string(),
    html_url: z.string().url().startsWith("https://github.com/"),
});

export interface LatestRelease {
    version: string;
    url: string;
}

export async function fetchLatestRelease(fetchFn: typeof fetch, userAgent: string): Promise<LatestRelease | null> {
    const response = await fetchFn(RELEASES_LATEST_URL, {
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": userAgent,
        },
        signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    });
    if (response.status !== 200) return null;
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return null;
    }
    const parsed = ReleaseSchema.safeParse(body);
    return parsed.success ? { version: parsed.data.tag_name, url: parsed.data.html_url } : null;
}

interface UpdateCheckDeps {
    currentVersion: string;
    fetch: typeof fetch;
    intervalMs?: number;
    notify: (latest: LatestRelease) => void;
}

export function startUpdateChecks(deps: UpdateCheckDeps): { stop(): void } {
    const check = async (): Promise<void> => {
        try {
            const latest = await fetchLatestRelease(deps.fetch, `DiscordMute-Bot/${deps.currentVersion}`);
            if (latest && isNewer(latest.version, deps.currentVersion)) deps.notify(latest);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.debug(logModules.Updates, `Update check failed: ${message}`);
        }
    };
    void check();
    const timer = setInterval(() => void check(), deps.intervalMs ?? UPDATE_INTERVAL_MS);
    timer.unref();
    return { stop: () => clearInterval(timer) };
}
