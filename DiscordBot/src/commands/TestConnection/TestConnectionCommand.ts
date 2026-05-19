import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { config } from "../../config";
import { logger, logModules } from "../../Logging/logger";
import { ContainerBuilder } from "../../Utils/ContainerBuilder";
import type { Command } from "../Command";

export class TestConnectionCommand implements Command {
    name = "testconnection";

    data = new SlashCommandBuilder()
        .setName("testconnection")
        .setDescription("Test the connection to the Among Us DiscordMute plugin");

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const url = `http://${config.plugin.ip}:${config.plugin.port}/ping?secret=${encodeURIComponent(config.secret)}`;
        const displayUrl = `http://${config.plugin.ip}:${config.plugin.port}/ping?secret=***`;
        const start = Date.now();

        logger.info(logModules.Command, `Testing plugin connection → ${displayUrl}`);

        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(5000),
            });
            const elapsed = Date.now() - start;

            if (!response.ok) {
                let body = "";
                try {
                    body = await response.text();
                } catch {
                    /* ignore */
                }
                logger.error(
                    logModules.Command,
                    `Plugin returned HTTP ${response.status} ${response.statusText} in ${elapsed}ms`,
                );
                if (body) logger.error(logModules.Command, `Response body: ${body}`);
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            logger.success(logModules.Command, `Plugin reachable — ping ${elapsed}ms (${displayUrl})`);

            const container = new ContainerBuilder()
                .title("Connection Successful", "✅")
                .divider()
                .text(`The Among Us plugin is reachable.\n**Ping:** \`${elapsed}ms\`\n**URL:** \`${displayUrl}\``)
                .success();

            await interaction.editReply({
                content: " ",
                components: [container.toJSON()],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (error) {
            const elapsed = Date.now() - start;
            const message = error instanceof Error ? error.message : String(error);

            logger.debug(
                logModules.Command,
                `Full error object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`,
            );

            if (!message.startsWith("HTTP ")) {
                // Network-level errors (connection refused, timeout, …)
                logger.error(logModules.Command, `Plugin unreachable after ${elapsed}ms — ${message}`);
                logger.error(logModules.Command, `Tried URL: ${displayUrl}`);
            }

            const container = new ContainerBuilder()
                .title("Connection Failed", "❌")
                .divider()
                .text(
                    `The Among Us plugin is not reachable.\n**Error:** \`${message}\`\n**URL:** \`${displayUrl}\`\n**Time:** \`${elapsed}ms\``,
                )
                .error();

            await interaction.editReply({
                components: [container.toJSON()],
                flags: MessageFlags.IsComponentsV2,
            });
        }
    }
}
