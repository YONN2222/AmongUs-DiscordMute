import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Config, parseConfig } from "../../src/Infrastructure/ConfigSchema";

const base = {
    token: "t",
    clientId: "c",
    guildId: "g",
    secret: "s",
};

describe("parseConfig", () => {
    it("parses the current example config unchanged", () => {
        const raw = JSON.parse(readFileSync(resolve(__dirname, "../../config.example.json"), "utf-8"));
        const config = parseConfig(raw);
        expect(config.channelIds).toEqual(raw.channelIds);
        expect(config.clusters).toEqual({ total: 1, shardsPerCluster: 1 });
        expect(config.sqlitePath).toBe("./data/linking.sqlite");
        expect(config.databaseDialect).toBe("sqlite");
    });

    it("rejects postgres without databaseUrl", () => {
        const result = Config.safeParse({ ...base, databaseDialect: "postgres" });
        expect(result.success).toBe(false);
        const issue = result.error?.issues[0];
        expect(issue?.message).toBe('databaseUrl is required when databaseDialect is "postgres"');
        expect(issue?.path).toEqual(["databaseUrl"]);
    });

    it("accepts postgres with databaseUrl", () => {
        const config = parseConfig({
            ...base,
            databaseDialect: "postgres",
            databaseUrl: "postgres://user:pw@localhost:5432/mute",
        });
        expect(config.databaseUrl).toBe("postgres://user:pw@localhost:5432/mute");
    });

    it("defaults channelIds to []", () => {
        expect(parseConfig(base).channelIds).toEqual([]);
    });
});
