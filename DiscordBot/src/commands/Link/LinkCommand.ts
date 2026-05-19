import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { config } from "../../config";
import { logger, logModules } from "../../Logging/logger";
import { ContainerBuilder } from "../../Utils/ContainerBuilder";
import { linkingService } from "../../Utils/LinkingService";
import type { Command } from "../Command";

export class LinkCommand implements Command {
    name = "link";

    data = new SlashCommandBuilder()
        .setName("link")
        .setDescription("Links your Discord account to your Among Us account name.");

    async execute(interaction: ChatInputCommandInteraction) {
        const phrase = linkingService.createPendingLink(interaction.user.id);
        let pluginReady = true;

        try {
            const payload = JSON.stringify({ secret: config.secret, phrase, discordId: interaction.user.id });
            const res = await fetch(`http://${config.plugin.ip}:${config.plugin.port}/link-pending`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-secret": config.secret },
                body: payload,
                signal: AbortSignal.timeout(5000),
            });

            if (!res.ok) {
                pluginReady = false;
                logger.warn(logModules.Command, `Plugin /link-pending rejected the request: HTTP ${res.status}`);
            } else {
                logger.debug(logModules.Command, `Plugin /link-pending response: HTTP ${res.status}`);
            }
        } catch (err) {
            pluginReady = false;
            logger.warn(
                logModules.Command,
                `Could not notify plugin of pending link: ${err instanceof Error ? err.message : err}`,
            );
        }

        if (!pluginReady) {
            const container = new ContainerBuilder()
                .title("Link Failed", "⚠️")
                .divider()
                .text(
                    "The Among Us plugin did not accept the pending link request.\n\n" +
                        "Start the game with the plugin loaded and run `/link` again.",
                )
                .warning();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
            return;
        }

        const container = new ContainerBuilder()
            .title("Link Account", "🔗")
            .divider()
            .text(
                "Open **Free Chat** in Among Us while in a lobby and type this phrase exactly:\n\n" +
                    `**\`${phrase}\`**\n\n` +
                    "This code expires in **5 minutes**.",
            )
            .info();

        logger.debug(logModules.Command, `Link phrase sent to ${interaction.user.id}: "${phrase}"`);

        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
        });

        linkingService.attachInteractionResponse(interaction.user.id, interaction.applicationId, interaction.token);
    }
}
