import type { Client } from "discord.js";
import { createProbe } from "probe.ts";

// probe.ts types resolve discord.js through its ESM typings, the bot through CJS: same runtime class, distinct declarations
type ProbeClient = Parameters<typeof createProbe>[0];

export function createTestProbe(client: Client): ReturnType<typeof createProbe> {
    return createProbe(client as unknown as ProbeClient);
}
