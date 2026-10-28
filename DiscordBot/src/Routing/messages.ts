import { z } from "zod";
import { type GameEventName, type GatewayNotice, NOTICE_CODES } from "../Protocol/PluginProtocol";

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
