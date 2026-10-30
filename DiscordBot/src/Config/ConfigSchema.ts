import { z } from "zod";
import { LOG_LEVEL_SETTINGS } from "../Logging/Logger";

export const LEGACY_SECRET_NEEDS_GUILD = "guildId is required when secret is set";

export const Config = z
    .object({
        token: z.string().min(1),
        clientId: z.string().min(1),
        /** Self-host: commands are deployed to this server only. Without it they are deployed globally. */
        guildId: z.string().min(1).optional(),
        /** Deprecated: choose the fallback voice channels in /setup. Still used for servers that chose none. */
        channelIds: z.array(z.string().min(1)).default([]),
        /** Deprecated: create the plugin secret in /setup. Still accepted for `guildId`. */
        secret: z.string().min(1).optional(),
        botIp: z.string().default("0.0.0.0"),
        botPort: z.number().int().positive().default(7264),
        databaseDialect: z.enum(["sqlite", "postgres"]).default("sqlite"),
        databaseUrl: z.string().url().optional(),
        sqlitePath: z.string().default("./data/linking.sqlite"),
        clusters: z
            .object({
                total: z.number().int().positive().default(1),
                shardsPerCluster: z.number().int().positive().default(1),
            })
            .default({ total: 1, shardsPerCluster: 1 }),
        disableTelemetry: z.boolean().default(false),
        disableUpdateCheck: z.boolean().default(false),
        logFormat: z.enum(["pretty", "json"]).default("pretty"),
        logLevel: z.enum(LOG_LEVEL_SETTINGS).default("info"),
        metrics: z
            .object({
                enabled: z.boolean().default(false),
                host: z.string().default("127.0.0.1"),
                port: z.number().int().min(1).max(65535).default(9464),
                token: z.string().min(16).optional(),
            })
            .default({ enabled: false, host: "127.0.0.1", port: 9464 }),
        mode: z.enum(["self-host", "hosted"]).default("self-host"),
        adminApi: z
            .object({
                host: z.string().default("127.0.0.1"),
                port: z.number().int().min(1).max(65535).default(9465),
            })
            .default({ host: "127.0.0.1", port: 9465 }),
    })
    .refine((c) => c.mode === "hosted" || c.secret === undefined || c.guildId !== undefined, {
        message: LEGACY_SECRET_NEEDS_GUILD,
        path: ["guildId"],
    })
    .refine((c) => c.databaseDialect !== "postgres" || c.databaseUrl !== undefined, {
        message: 'databaseUrl is required when databaseDialect is "postgres"',
        path: ["databaseUrl"],
    });

export type Config = z.infer<typeof Config>;

export function parseConfig(raw: unknown): Config {
    return Config.parse(raw);
}
