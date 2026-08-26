import { z } from "zod";

export const Config = z.object({
    token: z.string().min(1),
    clientId: z.string().min(1),
    guildId: z.string().min(1),
    channelIds: z.array(z.string().min(1)).min(1),
    secret: z.string().min(1),
    botIp: z.string().default("0.0.0.0"),
    botPort: z.number().int().positive().default(7264),
    databaseDialect: z.enum(["sqlite", "postgres"]).default("sqlite"),
});

export type Config = z.infer<typeof Config>;
