import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Config, parseConfig } from "../../src/Config/ConfigSchema";

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

    it("accepts a postgres URL with a remote host name", () => {
        const databaseUrl = "postgres://user:pass@host:5432/db";
        expect(parseConfig({ ...base, databaseDialect: "postgres", databaseUrl }).databaseUrl).toBe(databaseUrl);
    });

    it("defaults channelIds to []", () => {
        expect(parseConfig(base).channelIds).toEqual([]);
    });

    it("example config enables telemetry and update checks and keeps metrics off", () => {
        const raw = JSON.parse(readFileSync(resolve(__dirname, "../../config.example.json"), "utf-8"));
        const config = parseConfig(raw);
        expect(config.disableTelemetry).toBe(false);
        expect(config.disableUpdateCheck).toBe(false);
        expect(config.metrics.enabled).toBe(false);
        expect(config.logFormat).toBe("pretty");
    });

    it("example config does not mention the opt-out keys", () => {
        const text = readFileSync(resolve(__dirname, "../../config.example.json"), "utf-8");
        for (const key of ["disableTelemetry", "disableUpdateCheck", "metrics", "logFormat"]) {
            expect(text).not.toContain(key);
        }
    });

    it("defaults the metrics block", () => {
        expect(parseConfig(base).metrics).toEqual({ enabled: false, host: "127.0.0.1", port: 9464 });
    });

    it("partial metrics object keeps defaults", () => {
        expect(parseConfig({ ...base, metrics: { enabled: true } }).metrics).toEqual({
            enabled: true,
            host: "127.0.0.1",
            port: 9464,
        });
    });

    it("rejects a metrics token shorter than 16 chars", () => {
        expect(Config.safeParse({ ...base, metrics: { token: "short" } }).success).toBe(false);
        expect(Config.safeParse({ ...base, metrics: { token: "a".repeat(16) } }).success).toBe(true);
    });

    it("rejects an out of range metrics port", () => {
        expect(Config.safeParse({ ...base, metrics: { port: 0 } }).success).toBe(false);
        expect(Config.safeParse({ ...base, metrics: { port: 65536 } }).success).toBe(false);
    });

    it('rejects logFormat "xml"', () => {
        expect(Config.safeParse({ ...base, logFormat: "xml" }).success).toBe(false);
        expect(parseConfig({ ...base, logFormat: "json" }).logFormat).toBe("json");
    });

    it("defaults logLevel to info and rejects unknown levels", () => {
        expect(parseConfig(base).logLevel).toBe("info");
        expect(parseConfig({ ...base, logLevel: "debug" }).logLevel).toBe("debug");
        expect(Config.safeParse({ ...base, logLevel: "verbose" }).success).toBe(false);
    });

    it("example config is self-host and has no hosted keys", () => {
        const text = readFileSync(resolve(__dirname, "../../config.example.json"), "utf-8");
        const config = parseConfig(JSON.parse(text));
        expect(config.mode).toBe("self-host");
        expect(text).not.toContain('"mode"');
        expect(text).not.toContain('"adminApi"');
    });

    it("hosted config needs no guildId or secret", () => {
        const config = parseConfig({ token: "t", clientId: "c", mode: "hosted" });
        expect(config.mode).toBe("hosted");
        expect(config.guildId).toBeUndefined();
        expect(config.secret).toBeUndefined();
    });

    it("self-host config needs only the token and the client id", () => {
        const config = parseConfig({ token: "t", clientId: "c" });
        expect(config.mode).toBe("self-host");
        expect(config.guildId).toBeUndefined();
        expect(config.secret).toBeUndefined();
    });

    it("example config sets neither the deprecated secret nor channelIds", () => {
        const text = readFileSync(resolve(__dirname, "../../config.example.json"), "utf-8");
        expect(text).not.toContain('"secret"');
        expect(text).not.toContain('"channelIds"');
    });

    it("rejects the deprecated secret without a guildId", () => {
        const result = Config.safeParse({ token: "t", clientId: "c", secret: "s" });
        expect(result.success).toBe(false);
        const issue = result.error?.issues[0];
        expect(issue?.message).toBe("guildId is required when secret is set");
        expect(issue?.path).toEqual(["guildId"]);
    });

    it("partial adminApi keeps defaults", () => {
        expect(parseConfig({ ...base, adminApi: {} }).adminApi).toEqual({ host: "127.0.0.1", port: 9465 });
        expect(parseConfig({ ...base, adminApi: { port: 9000 } }).adminApi).toEqual({ host: "127.0.0.1", port: 9000 });
        expect(parseConfig(base).adminApi).toEqual({ host: "127.0.0.1", port: 9465 });
    });
});
