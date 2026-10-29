import { z } from "zod";
import {
    GAME_EVENT_NAMES,
    type GameEventName,
    type GatewayNotice,
    NOTICE_CODES,
    type RosterEntry,
} from "../Protocol/PluginProtocol";

/** Limit of the websocket close frame reason is 123 bytes; requests stay well below it. */
const MAX_CLOSE_REASON_LENGTH = 64;

export const GUILD_LEAVE_REASONS = ["guild-blocked", "owner-blocked", "admin"] as const;
export type GuildLeaveReason = (typeof GUILD_LEAVE_REASONS)[number];

export type ClusterRequest =
    | {
          kind: "game-event";
          guildId: string;
          sessionId: string;
          hostAccountName: string;
          event: GameEventName;
          players: string[];
          deadPlayers: string[];
          roster?: RosterEntry[];
          lobbyCode?: string;
      }
    | {
          kind: "session-started";
          guildId: string;
          sessionId: string;
          pluginVersion: string;
          gameVersion: string;
          protocolVersion: number;
      }
    | { kind: "session-ended"; guildId: string; sessionId: string }
    | {
          kind: "game-ended";
          guildId: string;
          sessionId: string;
          reason: string;
          winners: string[];
          roster: RosterEntry[];
      }
    | {
          kind: "link-confirmed";
          guildId: string;
          discordId: string;
          accountName: string;
          friendCode?: string;
          applicationId?: string;
          interactionToken?: string;
          locale?: "en" | "de";
      }
    | { kind: "leave-guild"; guildId: string; reason: GuildLeaveReason };

export type GatewayRequest =
    | {
          kind: "push-link-pending";
          guildId: string;
          phrase: string;
          quickChatCode: string;
          discordId: string;
      }
    | { kind: "is-plugin-connected"; guildId: string }
    | { kind: "disconnect-guild"; guildId: string; code: 4001 | 4005 | 4007; reason: string };

export type RouterReply = { ok: true; notice?: GatewayNotice } | { ok: false; error: string };

const replySchema = z.union([
    z.object({
        ok: z.literal(true),
        notice: z
            .object({
                code: z.enum(NOTICE_CODES),
                message: z.string(),
            })
            .optional(),
    }),
    z.object({ ok: z.literal(false), error: z.string() }),
]);

export function toRouterReply(value: unknown): RouterReply {
    const result = replySchema.safeParse(value);
    return result.success ? result.data : { ok: false, error: "invalid reply" };
}

const rosterSchema = z.array(
    z.object({
        name: z.string(),
        friendCode: z.string().optional(),
        dead: z.boolean(),
        disconnected: z.boolean(),
    }),
);

const clusterRequestSchema: z.ZodType<ClusterRequest> = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("game-event"),
        guildId: z.string(),
        sessionId: z.string(),
        hostAccountName: z.string(),
        event: z.enum(GAME_EVENT_NAMES),
        players: z.array(z.string()),
        deadPlayers: z.array(z.string()),
        roster: rosterSchema.optional(),
        lobbyCode: z.string().optional(),
    }),
    z.object({
        kind: z.literal("session-started"),
        guildId: z.string(),
        sessionId: z.string(),
        pluginVersion: z.string(),
        gameVersion: z.string(),
        protocolVersion: z.number().int(),
    }),
    z.object({ kind: z.literal("session-ended"), guildId: z.string(), sessionId: z.string() }),
    z.object({
        kind: z.literal("game-ended"),
        guildId: z.string(),
        sessionId: z.string(),
        reason: z.string(),
        winners: z.array(z.string()),
        roster: rosterSchema,
    }),
    z.object({
        kind: z.literal("link-confirmed"),
        guildId: z.string(),
        discordId: z.string(),
        accountName: z.string(),
        friendCode: z.string().optional(),
        applicationId: z.string().optional(),
        interactionToken: z.string().optional(),
        locale: z.enum(["en", "de"]).optional(),
    }),
    z.object({ kind: z.literal("leave-guild"), guildId: z.string(), reason: z.enum(GUILD_LEAVE_REASONS) }),
]);

const gatewayRequestSchema: z.ZodType<GatewayRequest> = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("push-link-pending"),
        guildId: z.string(),
        phrase: z.string(),
        quickChatCode: z.string(),
        discordId: z.string(),
    }),
    z.object({ kind: z.literal("is-plugin-connected"), guildId: z.string() }),
    z.object({
        kind: z.literal("disconnect-guild"),
        guildId: z.string(),
        code: z.union([z.literal(4001), z.literal(4005), z.literal(4007)]),
        reason: z.string().max(MAX_CLOSE_REASON_LENGTH),
    }),
]);

export function parseClusterRequest(value: unknown): ClusterRequest | null {
    const result = clusterRequestSchema.safeParse(value);
    return result.success ? result.data : null;
}

export function parseGatewayRequest(value: unknown): GatewayRequest | null {
    const result = gatewayRequestSchema.safeParse(value);
    return result.success ? result.data : null;
}
