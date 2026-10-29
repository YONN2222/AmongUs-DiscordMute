import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const websiteDirs = [
    resolve(repoRoot, "Website/shared/telemetry"),
    resolve(repoRoot, "../AmongUs-DiscordMute-web/Website/shared/telemetry"),
];
const websiteDir = websiteDirs.find(
    (dir) => existsSync(resolve(dir, "schema.ts")) && existsSync(resolve(dir, "contract.ts")),
);

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const read = (path: string) => normalize(readFileSync(path, "utf8"));

describe("telemetry contract copy", () => {
    it.skipIf(!websiteDir)("bot copy equals the website contract (skipped: Website/shared/telemetry not found)", () => {
        for (const file of ["schema.ts", "contract.ts"]) {
            expect(read(resolve(__dirname, "../../src/Telemetry/contract", file))).toBe(
                read(resolve(websiteDir as string, file)),
            );
        }
    });
});
