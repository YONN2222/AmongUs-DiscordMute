import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { ContainerBuilder } from "../../Utils/ContainerBuilder";
import { pluginSocket } from "../../Utils/PluginSocket";
import type { Command } from "../Command";

export class TestConnectionCommand implements Command {
    name = "testconnection";

    data = new SlashCommandBuilder()
        .setName("testconnection")
        .setDescription("Test the connection to the Among Us DiscordMute plugin");

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const connected = pluginSocket.isConnected();

        const container = connected
            ? new ContainerBuilder()
                  .title("Connection Successful", "✅")
                  .divider()
                  .text("The Among Us plugin is connected via WebSocket.")
                  .success()
            : new ContainerBuilder()
                  .title("Connection Failed", "❌")
                  .divider()
                  .text("The Among Us plugin is not connected.\n\nStart the game with the plugin loaded and try again.")
                  .error();

        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container.toJSON()],
        });
    }
}
