import { type ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { config } from "../../config";
import { logger, logModules } from "../../Logging/logger";
import { ContainerBuilder } from "../../Utils/ContainerBuilder";
import { linkingService } from "../../Utils/LinkingService";
import type { Command } from "../Command";

export class ForceLinkCommand implements Command {
    name = "force-link";

    data = new SlashCommandBuilder()
        .setName("force-link")
        .setDescription("Manually links a Discord user to an Among Us display name.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator)
        .addUserOption((option) => option.setName("user").setDescription("The Discord user to link").setRequired(true))
        .addStringOption((option) =>
            option.setName("display-name").setDescription("The Among Us display name").setRequired(true),
        );

    async execute(interaction: ChatInputCommandInteraction) {
        const user = interaction.options.getUser("user", true);
        const displayName = interaction.options.getString("display-name", true);
        const url = `http://${config.plugin.ip}:${config.plugin.port}/force-link`;

        try {
            linkingService.forceLink(user.id, displayName);

            let pluginNotified = true;
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accountName: displayName, discordId: user.id, secret: config.secret }),
                    signal: AbortSignal.timeout(5000),
                });

                const resBody = await response.text();

                if (!response.ok) {
                    pluginNotified = false;
                    logger.warn(
                        logModules.Command,
                        `Plugin /force-link rejected: HTTP ${response.status} Body: ${resBody}`,
                    );
                }
            } catch (err) {
                pluginNotified = false;
                logger.warn(logModules.Command, `Could not notify plugin of force link: ${err}`);
            }

            const container = new ContainerBuilder()
                .title(pluginNotified ? "Force Link Complete" : "Partial Link Complete", pluginNotified ? "✅" : "⚠️")
                .divider()
                .text(
                    `Manual link established in Bot.${pluginNotified ? " Plugin also updated." : " **Warning: Plugin could not be reached. Link might only work on Bot side until Plugin is active.**"}\n\n` +
                        `**Discord User:** ${user.toString()}\n**Among Us Name:** \`${displayName}\``,
                );
            if (pluginNotified) container.success();
            else container.warning();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
        } catch (error) {
            logger.error(logModules.Command, `Failed to force-link ${user.id} to ${displayName}`, error);

            const container = new ContainerBuilder()
                .title("Link Error", "❌")
                .text("An error occurred while manually linking the account.")
                .error();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
        }
    }
}
