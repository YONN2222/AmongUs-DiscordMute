import { REST, Routes } from "discord.js";
import { commandRegistry } from "./commands/Command";
import { DISCORD_CLIENT_ID, DISCORD_TOKEN } from "./config";
import { logger, logModules } from "./Logging/logger";

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

type DeployCommandsProps = {
    guildId: string;
    clusterId?: number;
};

export async function deployCommands({ guildId }: DeployCommandsProps) {
    const commandsData = commandRegistry.getCommandData();

    const totalSubcommands = commandsData.reduce((sum: number, cmd) => {
        const data = cmd as { options?: { type: number }[] };
        const subcommands = data.options?.filter((opt) => opt.type === 1) || [];
        return sum + subcommands.length;
    }, 0);
    const totalCount = commandsData.length + totalSubcommands;

    logger.info(
        logModules.Command,
        `Deploying ${totalCount} commands (${commandsData.length} base, ${totalSubcommands} subcommands) to guild ${guildId}...`,
    );

    try {
        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, guildId), {
            body: commandsData,
        });

        logger.success(
            logModules.Command,
            `Deployed ${totalCount} commands (${commandsData.length} base, ${totalSubcommands} subcommands) to guild ${guildId}`,
        );
    } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error && error.code === 50001) {
            logger.warn(logModules.Command, `Missing permissions for guild ${guildId}`);
        } else {
            logger.error(
                logModules.Command,
                `Failed to deploy to guild ${guildId}: ${error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : error}`,
                error,
            );
            throw error;
        }
    }
}
