import { describe, expect, it } from "vitest";
import { EXIT_CONFIG } from "../../src/Process/ExitCodes";
import {
    clusterSpawnOptions,
    isClusterProcess,
    isCompiledExecutable,
    loginFailureExitCode,
} from "../../src/Process/ProcessRole";

const BUN = "C:\\Users\\me\\.bun\\bin\\bun.exe";
const ENTRY = "C:\\bot\\src\\index.ts";

describe("isClusterProcess", () => {
    it("is true only with the variables the gateway sets for a cluster", () => {
        expect(isClusterProcess({ CLUSTER_ID: "0", SHARD_LIST: "0", TOTAL_SHARDS: "1" })).toBe(true);
        expect(isClusterProcess({ CLUSTER_ID: "0" })).toBe(false);
        expect(isClusterProcess({})).toBe(false);
    });
});

describe("isCompiledExecutable", () => {
    it("detects the virtual file system of a compiled Bun executable", () => {
        expect(isCompiledExecutable("B:\\~BUN\\root\\bot.exe", "C:\\bot\\bot.exe")).toBe(true);
        expect(isCompiledExecutable("B:/~BUN/root/bot.exe", "C:\\bot\\bot.exe")).toBe(true);
        expect(isCompiledExecutable("/$bunfs/root/bot", "/opt/bot/bot")).toBe(true);
    });

    it("treats a script run by the bun binary as not compiled", () => {
        expect(isCompiledExecutable(ENTRY, BUN)).toBe(false);
        expect(isCompiledExecutable("/home/me/bot/src/Index.ts", "/usr/local/bin/bun")).toBe(false);
    });

    it("falls back to the executable name when the entry path looks normal", () => {
        expect(isCompiledExecutable("C:\\bot\\bot.exe", "C:\\bot\\bot.exe")).toBe(true);
    });
});

describe("clusterSpawnOptions", () => {
    it("re-runs the entry script with bun when not compiled", () => {
        expect(clusterSpawnOptions(ENTRY, BUN)).toEqual({ command: BUN, args: [ENTRY], detached: false });
    });

    it("re-runs the executable itself when compiled", () => {
        expect(clusterSpawnOptions("B:\\~BUN\\root\\bot.exe", "C:\\bot\\bot.exe")).toEqual({
            command: "C:\\bot\\bot.exe",
            args: [],
            detached: false,
        });
    });
});

describe("loginFailureExitCode", () => {
    it("stops the bot only when Discord rejected the token", () => {
        expect(
            loginFailureExitCode(Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" })),
        ).toBe(EXIT_CONFIG);
    });

    it("lets galactic respawn the cluster after any other failure", () => {
        expect(loginFailureExitCode(Object.assign(new Error("Service Unavailable"), { status: 503 }))).toBe(1);
        expect(loginFailureExitCode(new Error("fetch failed"))).toBe(1);
        expect(loginFailureExitCode("nonsense")).toBe(1);
    });
});
