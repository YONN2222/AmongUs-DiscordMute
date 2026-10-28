import { z } from "zod";

export const Config = z
    .object({
        token: z.string().min(1),
        clientId: z.string().min(1),
        guildId: z.string().min(1),
        channelIds: z.array(z.string().min(1)).default([]),
        secret: z.string().min(1),
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
    })
    .refine((c) => c.databaseDialect !== "postgres" || c.databaseUrl !== undefined, {
        message: 'databaseUrl is required when databaseDialect is "postgres"',
        path: ["databaseUrl"],
    });

export type Config = z.infer<typeof Config>;

export function parseConfig(raw: unknown): Config {
    return Config.parse(raw);
}
