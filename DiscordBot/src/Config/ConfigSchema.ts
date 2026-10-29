import { z } from "zod";

export const SELF_HOST_FIELDS_REQUIRED = 'guildId and secret are required when mode is "self-host"';

export const Config = z
    .object({
        token: z.string().min(1),
        clientId: z.string().min(1),
        guildId: z.string().min(1).optional(),
        channelIds: z.array(z.string().min(1)).default([]),
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
    .refine((c) => c.mode !== "self-host" || (c.guildId !== undefined && c.secret !== undefined), {
        message: SELF_HOST_FIELDS_REQUIRED,
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
