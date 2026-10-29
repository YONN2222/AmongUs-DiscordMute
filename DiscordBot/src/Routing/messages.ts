import { z } from "zod";
import { GAME_EVENT_NAMES, type GameEventName, type GatewayNotice, NOTICE_CODES } from "../Protocol/PluginProtocol";

export type ClusterRequest =
    | {
          kind: "game-event";
          guildId: string;
          sessionId: string;
          hostAccountName: string;
          event: GameEventName;
          players: string[];
          deadPlayers: string[];
      }
    | { kind: "session-ended"; guildId: string; sessionId: string }
    | {
          kind: "link-confirmed";
          guildId: string;
          discordId: string;
          accountName: string;
          applicationId?: string;
          interactionToken?: string;
          locale?: "en" | "de";
      };

export type GatewayRequest =
    | {
          kind: "push-link-pending";
          guildId: string;
          phrase: string;
          quickChatCode: string;
          discordId: string;
      }
    | { kind: "is-plugin-connected"; guildId: string };

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

const clusterRequestSchema: z.ZodType<ClusterRequest> = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("game-event"),
        guildId: z.string(),
        sessionId: z.string(),
        hostAccountName: z.string(),
        event: z.enum(GAME_EVENT_NAMES),
        players: z.array(z.string()),
        deadPlayers: z.array(z.string()),
    }),
    z.object({ kind: z.literal("session-ended"), guildId: z.string(), sessionId: z.string() }),
    z.object({
        kind: z.literal("link-confirmed"),
        guildId: z.string(),
        discordId: z.string(),
        accountName: z.string(),
        applicationId: z.string().optional(),
        interactionToken: z.string().optional(),
        locale: z.enum(["en", "de"]).optional(),
    }),
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
]);

export function parseClusterRequest(value: unknown): ClusterRequest | null {
    const result = clusterRequestSchema.safeParse(value);
    return result.success ? result.data : null;
}

export function parseGatewayRequest(value: unknown): GatewayRequest | null {
    const result = gatewayRequestSchema.safeParse(value);
    return result.success ? result.data : null;
}
