import { type ChatInputCommandInteraction, type Client, Events, MessageFlags } from "discord.js";
import { type CommandContext, commandRegistry } from "../Commands/Command";
import { localeFrom, t } from "../I18n/Index";
import { LINK_SELF_UNLINK_BUTTON_ID, unlinkSelf } from "../Linking/SelfUnlink";
import { registerLinkOverviewComponents } from "../LinkOverview/LinkOverviewComponents";
import { logger, logModules } from "../Logging/Logger";
import { registerSetupComponents } from "../Setup/SetupComponents";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { isComponentInteraction, registerComponent, routeComponent } from "./ComponentRouter";

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
        const locale = localeFrom(interaction.locale);
        const container = new ContainerBuilder()
            .title(t(locale, "error.title"), "❌")
            .text(t(locale, "error.generic"))
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
            await interaction.reply({
                content: t(localeFrom(interaction.locale), "error.commandUnavailable"),
                flags: MessageFlags.Ephemeral,
            });
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

/** Every component prefix the bot answers; later features add their own registration here. */
function registerComponents(): void {
    registerComponent(LINK_SELF_UNLINK_BUTTON_ID, async (interaction, ctx) => {
        if (interaction.isButton()) await unlinkSelf(interaction, ctx);
    });
    registerLinkOverviewComponents();
    registerSetupComponents();
}

export function registerInteractionHandlers(client: Client, ctx: CommandContext): void {
    registerComponents();
    client.on(Events.InteractionCreate, async (interaction) => {
        if (isComponentInteraction(interaction)) {
            await routeComponent(interaction, ctx);
            return;
        }
        if (interaction.isChatInputCommand()) await handleChatInput(interaction, ctx);
    });
}
