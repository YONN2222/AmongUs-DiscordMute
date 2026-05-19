import { z } from "zod";

export const ConfigPlugin = z.object({
    ip: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(7263),
});

export type ConfigPlugin = z.infer<typeof ConfigPlugin>;

export const Config = z.object({
    token: z.string().min(1),
    clientId: z.string().min(1),
    guildId: z.string().min(1),
    channelIds: z.array(z.string().min(1)).min(1),
    secret: z.string().min(1),
    botIp: z.string().default("0.0.0.0"),
    botPort: z.number().int().positive().default(7264),
    plugin: ConfigPlugin.default({ ip: "127.0.0.1", port: 7263 }),
});

export type Config = z.infer<typeof Config>;
