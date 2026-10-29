import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { localeFrom, localized, t } from "../../i18n";
import { ContainerBuilder } from "../../Utils/ContainerBuilder";
import type { Command, CommandContext } from "../Command";

export class TestConnectionCommand implements Command {
    name = "testconnection";

    data = localized(new SlashCommandBuilder().setName("testconnection"), "testConnection.description");

    async execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
        const locale = localeFrom(interaction.locale);
        const connected = interaction.guildId !== null && (await ctx.isPluginConnected(interaction.guildId));

        const container = connected
            ? new ContainerBuilder()
                  .title(t(locale, "testConnection.ok.title"), "✅")
                  .divider()
                  .text(t(locale, "testConnection.ok.body"))
                  .success()
            : new ContainerBuilder()
                  .title(t(locale, "testConnection.fail.title"), "❌")
                  .divider()
                  .text(t(locale, "testConnection.fail.body"))
                  .error();

        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container.toJSON()],
        });
    }
}
