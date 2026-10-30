import { logger, logModules } from "../Logging/Logger";
import type { PluginMessage } from "../Protocol/PluginProtocol";

export type PluginLogMessage = Extract<PluginMessage, { type: "plugin-log" }>;

/** Writes a log line the plugin sent into the bot's log, at the matching level. */
export function logPluginMessage(message: PluginLogMessage): void {
    const text = `[${message.source}] ${message.message}`;
    switch (message.level) {
        case "debug":
            logger.debug(logModules.AmongUs, text);
            return;
        case "warning":
            logger.warn(logModules.AmongUs, text);
            return;
        case "error":
        case "fatal":
            logger.error(logModules.AmongUs, text);
            return;
        default:
            logger.info(logModules.AmongUs, text);
    }
}
