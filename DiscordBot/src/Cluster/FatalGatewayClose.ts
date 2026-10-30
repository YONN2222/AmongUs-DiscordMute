import { type Client, Events, GatewayCloseCodes } from "discord.js";

const FATAL_CLOSE_MESSAGES: Partial<Record<number, string>> = {
    [GatewayCloseCodes.AuthenticationFailed]: "Discord rejected the token, check the token in config.json",
    [GatewayCloseCodes.InvalidShard]: "Discord rejected the shard setup, check clusters in config.json",
    [GatewayCloseCodes.ShardingRequired]:
        "Discord requires more shards for this bot, raise clusters.total or clusters.shardsPerCluster in config.json",
    [GatewayCloseCodes.InvalidIntents]: "Discord rejected the gateway intents the bot asked for",
    [GatewayCloseCodes.DisallowedIntents]:
        "Enable the Server Members intent for the bot in the Discord developer portal",
};

/** The message for a gateway close code that a reconnect or restart cannot fix, or null for any other code. */
export function fatalGatewayCloseMessage(code: number): string | null {
    return FATAL_CLOSE_MESSAGES[code] ?? null;
}

/**
 * discord.js gives up on a shard after these codes: it emits shardDisconnect with the code, and a pending
 * login() rejects with a plain Error that carries no code.
 */
export function onFatalGatewayClose(client: Client, handler: (message: string, shardId: number) => void): void {
    client.on(Events.ShardDisconnect, ({ code }, shardId) => {
        const message = fatalGatewayCloseMessage(code);
        if (message) handler(message, shardId);
    });
}
