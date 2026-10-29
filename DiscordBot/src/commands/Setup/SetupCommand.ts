import { type ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { localeFrom, localized } from "../../i18n";
import { buildSetupPanel, replyEphemeralText } from "../../Setup/setupComponents";
import { canManageServer } from "../../Utils/permissions";
import type { Command, CommandContext } from "../Command";

export class SetupCommand implements Command {
    name = "setup";

    data = localized(new SlashCommandBuilder().setName("setup"), "setup.description")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setContexts(0);

    async execute(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
        const locale = localeFrom(interaction.locale);
        if (!interaction.guildId) {
            await replyEphemeralText(interaction, locale, "link.guildOnly");
            return;
        }
        if (!canManageServer(interaction.memberPermissions)) {
            await replyEphemeralText(interaction, locale, "error.missingPermission");
            return;
        }
        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: await buildSetupPanel(ctx, interaction.guildId, "general", locale),
        });
    }
}
