import { MessageFlags, type RepliableInteraction } from "discord.js";
import { localeFrom, t } from "../I18n/Index";
import { ContainerBuilder } from "../Utils/ContainerBuilder";

interface GenericErrorOptions {
    /** When the interaction was already answered: true sends a follow-up, false sends nothing. */
    followUpWhenAnswered: boolean;
}

/** Tells the user something went wrong. Throws when Discord rejects the reply, so callers decide how to log it. */
export async function replyGenericError(
    interaction: RepliableInteraction,
    { followUpWhenAnswered }: GenericErrorOptions,
): Promise<void> {
    const answered = interaction.replied || interaction.deferred;
    if (answered && !followUpWhenAnswered) return;

    const locale = localeFrom(interaction.locale);
    const container = new ContainerBuilder()
        .title(t(locale, "error.title"))
        .text(t(locale, "error.generic"))
        .footer()
        .error();
    const payload = {
        components: [container.toJSON()],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    } as const;
    if (answered) await interaction.followUp(payload);
    else await interaction.reply(payload);
}
