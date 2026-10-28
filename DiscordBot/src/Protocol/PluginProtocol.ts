import { z } from "zod";

export const PROTOCOL_VERSION = 2;
export const MIN_PROTOCOL_VERSION = 2;

export const CLOSE_HELLO_TIMEOUT = 4000;
export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_PROTOCOL_TOO_OLD = 4002;
export const CLOSE_INVALID_MESSAGE = 4003;
export const CLOSE_REPLACED = 4004;

export const GAME_EVENT_NAMES = ["lobby", "game-start", "meeting-start", "meeting-end"] as const;
export type GameEventName = (typeof GAME_EVENT_NAMES)[number];

const name = z.string().max(64);
const nameList = z.array(name).max(128);

const helloSchema = z.object({
    type: z.literal("hello"),
    protocolVersion: z.number().int(),
    secret: z.string().min(1).max(256),
    pluginVersion: z.string().max(32),
    gameVersion: z.string().max(32),
});

const gameEventSchema = z.object({
    type: z.literal("game-event"),
    event: z.enum(GAME_EVENT_NAMES),
    hostAccountName: name,
    players: nameList,
    deadPlayers: nameList,
});

const linkChatSchema = z.object({
    type: z.literal("link-chat"),
    code: name,
    accountName: name,
});

const pluginLogSchema = z.object({
    type: z.literal("plugin-log"),
    level: z.enum(["debug", "info", "warning", "error", "fatal"]),
    source: name,
    message: z.string().max(2000),
});

const pluginMessageSchema = z.discriminatedUnion("type", [
    helloSchema,
    gameEventSchema,
    linkChatSchema,
    pluginLogSchema,
]);

export type PluginMessage = z.infer<typeof pluginMessageSchema>;

export const NOTICE_CODES = ["host-not-linked", "host-not-in-voice", "cluster-unavailable"] as const;

export interface GatewayNotice {
    code: (typeof NOTICE_CODES)[number];
    message: string;
}

export type GatewayMessage =
    | { type: "welcome"; protocolVersion: number }
    | {
          type: "link-pending";
          phrase: string;
          quickChatCode: string;
          discordId: string;
      }
    | ({ type: "notice" } & GatewayNotice)
    | { type: "link-result"; status: "linked" | "not-found"; accountName: string };

export function parsePluginMessage(raw: string): PluginMessage | null {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return null;
    }
    const result = pluginMessageSchema.safeParse(json);
    return result.success ? result.data : null;
}

export function serialize(msg: GatewayMessage): string {
    return JSON.stringify(msg);
}
