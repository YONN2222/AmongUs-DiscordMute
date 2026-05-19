import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { logger, logModules } from "../Logging/logger";
import { commandConstructors } from "./generated";

export interface Command {
    name: string;

    data: SlashCommandBuilder | { toJSON: () => unknown; name: string; description: string };

    execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export class CommandRegistry {
    private commands = new Map<string, Command>();

    register(command: Command): void {
        if (!command.name.match(/^[-_\p{L}\p{N}]{1,32}$/u)) {
            throw new Error(`Command name is invalid: ${command.name}`);
        }

        this.commands.set(command.name, command);
    }

    registerMultiple(...commands: Command[]): void {
        for (const command of commands) {
            this.register(command);
        }
    }

    get(name: string): Command | undefined {
        return this.commands.get(name);
    }

    getAll(): Command[] {
        return Array.from(this.commands.values());
    }

    get size(): number {
        return this.commands.size;
    }

    getCommandData(): unknown[] {
        return this.getAll().map((cmd) => cmd.data.toJSON());
    }
}

export const commandRegistry = new CommandRegistry();

function loadCommands() {
    try {
        for (const CommandClass of commandConstructors) {
            try {
                const command = new CommandClass();
                if (command.name && command.data && typeof command.execute === "function") {
                    commandRegistry.register(command);
                    logger.debug(logModules.Command, `Registered command: ${command.name}`);
                }
            } catch (fileError) {
                const commandName = CommandClass.name || "unknown";
                logger.warn(
                    logModules.Command,
                    `Failed to load command from ${commandName}: ${fileError instanceof Error ? fileError.message : fileError}`,
                );
            }
        }

        const commandDetails = commandRegistry.getAll().map((cmd) => {
            const data = cmd.data.toJSON() as { options?: { type: number; name: string }[] };
            const subcommands = data.options?.filter((opt) => opt.type === 1).map((opt) => opt.name) || [];
            return {
                name: cmd.name,
                subcommands,
                display: subcommands.length > 0 ? `${cmd.name} [${subcommands.join(", ")}]` : cmd.name,
            };
        });

        const totalCommands = commandRegistry.size;
        const totalSubcommands = commandDetails.reduce((sum, cmd) => sum + cmd.subcommands.length, 0);
        const totalCount = totalCommands + totalSubcommands;

        logger.success(
            logModules.Command,
            `Loaded ${totalCount} commands (${totalCommands} base, ${totalSubcommands} subcommands): ${commandDetails.map((c) => c.display).join(", ")}`,
        );
    } catch (error) {
        logger.error(logModules.Command, "Failed to load commands", error);
    }
}

loadCommands();
