import { win32 } from "node:path";
import type { SpawnOptions } from "galactic.ts";

/**
 * A cluster exits with this code when Discord refuses the bot in a way a restart cannot fix (token, intents,
 * shards), so the gateway stops instead of respawning it.
 */
export const CLUSTER_EXIT_LOGIN_FAILED = 78;

/** Only an invalid token is final; any other failure exits 1 so galactic starts the cluster again. */
export function loginFailureExitCode(error: unknown): number {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return code === "TokenInvalid" ? CLUSTER_EXIT_LOGIN_FAILED : 1;
}

/** galactic starts every cluster process with these variables; the gateway process never has them. */
export function isClusterProcess(env: Record<string, string | undefined>): boolean {
    return env.CLUSTER_ID !== undefined && env.SHARD_LIST !== undefined && env.TOTAL_SHARDS !== undefined;
}

const BUN_VIRTUAL_ROOT = /^(\/\$bunfs\/|[A-Za-z]:[\\/]~BUN[\\/])/;
const BUN_BINARY = /^bun(-debug)?(\.exe)?$/i;

/**
 * A compiled Bun executable serves its entry from a virtual file system (`B:\~BUN\root` on Windows,
 * `/$bunfs/root` elsewhere). If that ever changes, an executable that is not the bun binary itself
 * is still the bot: a plain `bun src/index.ts` always runs under `bun`/`bun.exe`.
 */
export function isCompiledExecutable(mainPath: string, execPath: string): boolean {
    return BUN_VIRTUAL_ROOT.test(mainPath) || !BUN_BINARY.test(win32.basename(execPath));
}

/** The gateway spawns clusters as a copy of itself: the executable alone, or bun with the entry script. */
export function clusterSpawnOptions(mainPath: string, execPath: string): SpawnOptions {
    return {
        command: execPath,
        args: isCompiledExecutable(mainPath, execPath) ? [] : [mainPath],
        detached: false,
    };
}
