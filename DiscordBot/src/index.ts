import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { commandRegistry } from "./commands/Command";
import { config, DISCORD_GUILD_ID, DISCORD_TOKEN } from "./config";
import { deployCommands } from "./deploy-commands";
import { logger, logModules } from "./Logging/logger";
import { ContainerBuilder } from "./Utils/ContainerBuilder";
import { HttpServer } from "./Utils/HttpServer";
import { MuteService } from "./Utils/MuteService";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

const muteService = new MuteService(client, config);

client.once(Events.ClientReady, async (readyClient) => {
    logger.success(logModules.Discord, `Logged in as ${readyClient.user.tag}`);

    const httpServer = new HttpServer(config, muteService);
    await httpServer.start();

    if (DISCORD_GUILD_ID) {
        try {
            await deployCommands({ guildId: DISCORD_GUILD_ID });
        } catch (error) {
            logger.error(logModules.Command, "Failed to deploy commands during startup", error);
        }
    } else {
        logger.warn(logModules.Command, "No DISCORD_GUILD_ID found in config, skipping command deployment.");
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const guild = interaction.guild?.name ?? "DM";
    const channel = interaction.channel && "name" in interaction.channel ? interaction.channel.name : "unknown";

    const options = interaction.options.data
        .map((o) => {
            if (o.type === 1 || o.type === 2) {
                const subOptions = o.options ? o.options.map((so) => `${so.name}:${so.value}`).join(" ") : "";
                return subOptions ? `${o.name} ${subOptions}` : o.name;
            }
            return `${o.name}:${o.value}`;
        })
        .join(", ");

    logger.info(
        logModules.Command,
        `/${commandName}${options ? ` [${options}]` : ""} by ${interaction.user.tag} in #${channel} (${guild})`,
    );

    const command = commandRegistry.get(commandName);
    if (!command) {
        logger.warn(logModules.Command, `No handler found for command: ${commandName}`);
        try {
            await interaction.reply({
                content: "Command is not available.",
                flags: MessageFlags.Ephemeral,
            });
        } catch (replyError) {
            logger.error(logModules.Command, "Failed to send 'command not available' message", replyError);
        }
        return;
    }

    try {
        await command.execute(interaction);
        logger.debug(logModules.Command, `/${commandName} completed successfully for ${interaction.user.tag}`);
    } catch (error) {
        logger.error(logModules.Command, `/${commandName} failed for ${interaction.user.tag}`, error);

        if (!interaction.replied && !interaction.deferred) {
            try {
                const container = new ContainerBuilder()
                    .title("Fehler", "❌")
                    .text(
                        "Es ist ein Fehler beim Ausführen dieses Befehls aufgetreten. Bitte versuche es später erneut.",
                    )
                    .error();

                await interaction.reply({
                    components: [container.toJSON()],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error(
                    logModules.Command,
                    `Failed to send error message to user for /${commandName}`,
                    replyError,
                );
            }
        }
    }
});

client.login(DISCORD_TOKEN).catch((error) => {
    logger.error(logModules.Bot, "Failed to login to Discord", error);
    process.exit(1);
});

process.on("SIGINT", () => {
    logger.warn(logModules.Bot, "SIGINT received, shutting down...");
    client.destroy();
    process.exit(0);
});

process.on("SIGTERM", () => {
    logger.warn(logModules.Bot, "SIGTERM received, shutting down...");
    client.destroy();
    process.exit(0);
});

process.on("unhandledRejection", (error) => {
    logger.error(logModules.Bot, "Unhandled Promise Rejection", error);
});

process.on("uncaughtException", (error) => {
    logger.error(logModules.Bot, "Uncaught Exception", error);
    process.exit(1);
});
