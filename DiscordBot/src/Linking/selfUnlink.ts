import { type ButtonInteraction, MessageFlags } from "discord.js";
import type { CommandContext } from "../commands/Command";
import { localeFrom, t } from "../i18n";
import { ContainerBuilder } from "../Utils/ContainerBuilder";

export const LINK_SELF_UNLINK_BUTTON_ID = "link-self-unlink";

export async function unlinkSelf(interaction: ButtonInteraction, ctx: CommandContext): Promise<void> {
    if (!interaction.guildId) return;
    const locale = localeFrom(interaction.locale);

    const removed = await ctx.linking.removeLink(interaction.guildId, interaction.user.id, interaction.user.id);

    const container = removed
        ? new ContainerBuilder()
              .title(t(locale, "link.reset.title"), "✅")
              .divider()
              .text(t(locale, "link.reset.selfDone"))
              .success()
        : new ContainerBuilder()
              .title(t(locale, "link.reset.noneTitle"), "⚠️")
              .text(t(locale, "link.reset.selfNone"))
              .warning();

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
    });
}
