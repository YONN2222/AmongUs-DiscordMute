import { DiscordAPIError, MessageFlags, type REST, Routes } from "discord.js";
import { type Locale, t } from "../I18n/Index";
import { logger, logModules } from "../Logging/Logger";
import { ContainerBuilder, TITLE_ICON } from "../Utils/ContainerBuilder";
import { errorMessage } from "../Utils/ErrorMessage";
import type { ConfirmedLinkReply } from "./ClusterRequestHandler";

/** The webhook URL of a failed call carries the interaction token, so only status, code and message are logged. */
function describeRestError(error: unknown): string {
    if (error instanceof DiscordAPIError) return `${error.status} ${error.code} ${error.message}`;
    return errorMessage(error);
}

/** The language of the user who ran /link self, else the server language, else english. */
export async function resolveLinkReplyLocale(
    link: ConfirmedLinkReply,
    guildLanguage: (guildId: string) => Promise<Locale>,
): Promise<Locale> {
    if (link.locale) return link.locale;
    try {
        return await guildLanguage(link.guildId);
    } catch (error) {
        logger.error(logModules.Command, `Could not look up the language of guild ${link.guildId}`, error);
        return "en";
    }
}

/** Edits the original ephemeral /link reply through the interaction webhook once the plugin confirmed the code. */
export async function updateOriginalLinkReply(rest: REST, link: ConfirmedLinkReply, locale: Locale): Promise<boolean> {
    if (!link.applicationId || !link.interactionToken) {
        logger.warn(
            logModules.Command,
            `Cannot update original /link reply for Discord ${link.discordId}: missing interaction webhook data`,
        );
        return false;
    }

    const container = new ContainerBuilder()
        .title(t(locale, "link.complete.title"), TITLE_ICON.success)
        .divider()
        .text(t(locale, "link.complete.body", { discordId: link.discordId, accountName: link.accountName }))
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
