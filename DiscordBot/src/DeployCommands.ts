import { REST, Routes } from "discord.js";
import { commandRegistry } from "./Commands/Command";
import { DISCORD_CLIENT_ID, DISCORD_TOKEN } from "./Config";
import { logger, logModules } from "./Logging/Logger";

type DeployCommandsProps = {
    /** One guild updates at once; "global" publishes the commands for every server the bot is in. */
    target: { guildId: string } | "global";
    /** A cluster passes its logged-in client's REST so deploys share its rate limits. */
    rest?: REST;
};

export async function deployCommands({
    target,
    rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN),
}: DeployCommandsProps): Promise<void> {
    const place = target === "global" ? "all guilds" : `guild ${target.guildId}`;
    const route =
        target === "global"
            ? Routes.applicationCommands(DISCORD_CLIENT_ID)
            : Routes.applicationGuildCommands(DISCORD_CLIENT_ID, target.guildId);
    const commandsData = commandRegistry.getCommandData();

    const totalSubcommands = commandsData.reduce((sum: number, cmd) => {
        const data = cmd as { options?: { type: number }[] };
        const subcommands = data.options?.filter((opt) => opt.type === 1) || [];
        return sum + subcommands.length;
    }, 0);
    const totalCount = commandsData.length + totalSubcommands;

    logger.info(
        logModules.Command,
        `Deploying ${totalCount} commands (${commandsData.length} base, ${totalSubcommands} subcommands) to ${place}...`,
    );

    try {
        await rest.put(route, { body: commandsData });

        logger.success(
            logModules.Command,
            `Deployed ${totalCount} commands (${commandsData.length} base, ${totalSubcommands} subcommands) to ${place}`,
        );
    } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error && error.code === 50001) {
            logger.warn(logModules.Command, `Missing permissions for ${place}`);
        } else {
            logger.error(
                logModules.Command,
                `Failed to deploy to ${place}: ${error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : error}`,
                error,
            );
            throw error;
        }
    }
}
