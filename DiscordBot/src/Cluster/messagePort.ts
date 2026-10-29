import { type Client, DiscordAPIError, MessageFlags, Routes } from "discord.js";

export type PostFailure = "missing-access" | "unknown-channel" | "unknown-message" | "other";

const MISSING_ACCESS_CODES = new Set([50001, 50013]);
const UNKNOWN_CHANNEL_CODE = 10003;
const UNKNOWN_MESSAGE_CODE = 10008;

export function classifyDiscordError(err: unknown): PostFailure {
    if (!(err instanceof DiscordAPIError)) return "other";
    const code = Number(err.code);
    if (MISSING_ACCESS_CODES.has(code)) return "missing-access";
    if (code === UNKNOWN_CHANNEL_CODE) return "unknown-channel";
    if (code === UNKNOWN_MESSAGE_CODE) return "unknown-message";
    return "other";
}

export interface MessagePayload {
    components: unknown[];
}

/** Sends, edits and deletes public components v2 messages by id, so no channel cache is needed. */
export interface MessagePort {
    post(channelId: string, payload: MessagePayload): Promise<string>;
    edit(channelId: string, messageId: string, payload: MessagePayload): Promise<void>;
    delete(channelId: string, messageId: string): Promise<void>;
}

function body(payload: MessagePayload) {
    return {
        components: payload.components,
        flags: MessageFlags.IsComponentsV2,
        allowed_mentions: { parse: [] },
    };
}

export function createDiscordMessagePort(client: Client): MessagePort {
    return {
        async post(channelId, payload) {
            const message = (await client.rest.post(Routes.channelMessages(channelId), {
                body: body(payload),
            })) as { id: string };
            return message.id;
        },
        async edit(channelId, messageId, payload) {
            await client.rest.patch(Routes.channelMessage(channelId, messageId), { body: body(payload) });
        },
        async delete(channelId, messageId) {
            await client.rest.delete(Routes.channelMessage(channelId, messageId));
        },
    };
}
