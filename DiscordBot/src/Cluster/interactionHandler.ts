import { type ChatInputCommandInteraction, type Client, Events, MessageFlags } from "discord.js";
import { type CommandContext, commandRegistry } from "../commands/Command";
import { handleLinkSelfUnlinkButton, LINK_SELF_UNLINK_BUTTON_ID } from "../commands/Link/LinkCommand";
import { logger, logModules } from "../Logging/logger";
import { ContainerBuilder } from "../Utils/ContainerBuilder";

function describeOptions(interaction: ChatInputCommandInteraction): string {
    return interaction.options.data
        .map((o) => {
            if (o.type === 1 || o.type === 2) {
                const subOptions = o.options ? o.options.map((so) => `${so.name}:${so.value}`).join(" ") : "";
                return subOptions ? `${o.name} ${subOptions}` : o.name;
            }
            return `${o.name}:${o.value}`;
        })
        .join(", ");
}

async function replyCommandFailed(interaction: ChatInputCommandInteraction): Promise<void> {
    if (interaction.replied || interaction.deferred) return;
    try {
        const container = new ContainerBuilder()
            .title("Fehler", "❌")
            .text("Es ist ein Fehler beim Ausführen dieses Befehls aufgetreten. Bitte versuche es später erneut.")
            .error();
        await interaction.reply({
            components: [container.toJSON()],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    } catch (replyError) {
        logger.error(
            logModules.Command,
            `Failed to send error message to user for /${interaction.commandName}`,
            replyError,
        );
    }
}

async function handleChatInput(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
    const { commandName } = interaction;
    const guild = interaction.guild?.name ?? "DM";
    const channel = interaction.channel && "name" in interaction.channel ? interaction.channel.name : "unknown";
    const options = describeOptions(interaction);
    logger.info(
        logModules.Command,
        `/${commandName}${options ? ` [${options}]` : ""} by ${interaction.user.tag} in #${channel} (${guild})`,
    );

    const command = commandRegistry.get(commandName);
    if (!command) {
        logger.warn(logModules.Command, `No handler found for command: ${commandName}`);
        try {
            await interaction.reply({ content: "Command is not available.", flags: MessageFlags.Ephemeral });
        } catch (replyError) {
            logger.error(logModules.Command, "Failed to send 'command not available' message", replyError);
        }
        return;
    }

    try {
        await command.execute(interaction, ctx);
        logger.debug(logModules.Command, `/${commandName} completed successfully for ${interaction.user.tag}`);
    } catch (error) {
        logger.error(logModules.Command, `/${commandName} failed for ${interaction.user.tag}`, error);
        await replyCommandFailed(interaction);
    }
}

export function registerInteractionHandlers(client: Client, ctx: CommandContext): void {
    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isButton() && interaction.customId === LINK_SELF_UNLINK_BUTTON_ID) {
            try {
                await handleLinkSelfUnlinkButton(interaction, ctx);
            } catch (error) {
                logger.error(logModules.Command, `Failed to handle unlink button for ${interaction.user.tag}`, error);
            }
            return;
        }
        if (interaction.isChatInputCommand()) await handleChatInput(interaction, ctx);
    });
}
