import { MessageFlags, type RepliableInteraction } from "discord.js";
import { localeFrom, t } from "../I18n/Index";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import type { BlockChecker } from "./BlockChecker";

/** Answers a blocked user privately. True means the interaction is handled; without a checker nobody is blocked. */
export async function rejectBlockedUser(
    interaction: RepliableInteraction,
    blocks: BlockChecker | undefined,
): Promise<boolean> {
    if (!blocks || !(await blocks.isUserBlocked(interaction.user.id))) return false;
    const container = new ContainerBuilder()
        .title(t(localeFrom(interaction.locale), "error.title"))
        .text(t(localeFrom(interaction.locale), "error.blocked"))
        .footer()
        .error();
    await interaction.reply({
        components: [container.toJSON()],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return true;
}
