import { DiscordAPIError, MessageFlags, type REST, Routes } from "discord.js";
import { logger, logModules } from "../Logging/logger";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import type { ConfirmedLinkReply } from "./clusterRequestHandler";

/** The webhook URL of a failed call carries the interaction token, so only status, code and message are logged. */
function describeRestError(error: unknown): string {
    if (error instanceof DiscordAPIError) return `${error.status} ${error.code} ${error.message}`;
    return error instanceof Error ? error.message : String(error);
}

/** Edits the original ephemeral /link reply through the interaction webhook once the plugin confirmed the code. */
export async function updateOriginalLinkReply(rest: REST, link: ConfirmedLinkReply): Promise<boolean> {
    if (!link.applicationId || !link.interactionToken) {
        logger.warn(
            logModules.Command,
            `Cannot update original /link reply for Discord ${link.discordId}: missing interaction webhook data`,
        );
        return false;
    }

    const container = new ContainerBuilder()
        .title("Link Complete", "✅")
        .divider()
        .text(
            `Your Discord account is now linked.\n\n**Discord ID:** \`${link.discordId}\`\n**Among Us Account:** \`${link.accountName}\``,
        )
        .success();

    try {
        await rest.patch(Routes.webhookMessage(link.applicationId, link.interactionToken, "@original"), {
            body: { content: " ", components: [container.toJSON()], flags: MessageFlags.IsComponentsV2 },
        });
        return true;
    } catch (error) {
        logger.error(
            logModules.Command,
            `Failed to update original /link reply for Discord ${link.discordId}: ${describeRestError(error)}`,
        );
        return false;
    }
}
