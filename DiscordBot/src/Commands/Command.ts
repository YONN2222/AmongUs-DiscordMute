import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { AuditLogRepository } from "../Data/Repositories/AuditLogRepository";
import type { GuildSecretRepository } from "../Data/Repositories/GuildSecretRepository";
import type { GuildEventBus } from "../Events/GuildEvents";
import type { BlockChecker } from "../Hosted/BlockChecker";
import type { LinkingService } from "../Linking/LinkingService";
import { logger, logModules } from "../Logging/Logger";
import type { CLOSE_BLOCKED, CLOSE_UNAUTHORIZED } from "../Protocol/PluginProtocol";
import type { SettingsService } from "../Settings/SettingsService";
import { commandConstructors } from "./Generated";

/** What /setup needs to create and replace the plugin secret of a server. */
export interface SecretCommandContext {
    secrets: Pick<GuildSecretRepository, "rotate" | "get">;
    /** Secret changes are written to the audit log when this is set. */
    audit?: Pick<AuditLogRepository, "record">;
    /** Closes the plugin connections of a guild; resolves to false when none was open. */
    disconnectGuild(
        guildId: string,
        code: typeof CLOSE_UNAUTHORIZED | typeof CLOSE_BLOCKED,
        reason: string,
    ): Promise<boolean>;
}

export interface HostedCommandContext extends SecretCommandContext {
    audit: Pick<AuditLogRepository, "record">;
    blocks: BlockChecker;
}

export interface CommandContext {
    linking: LinkingService;
    events: Pick<GuildEventBus, "emit">;
    settings: Pick<SettingsService, "get" | "update">;
    pushLinkPending(guildId: string, phrase: string, quickChatCode: string, discordId: string): Promise<boolean>;
    isPluginConnected(guildId: string): Promise<boolean>;
    pluginSecret: SecretCommandContext;
    /** Set only in hosted mode. */
    hosted?: HostedCommandContext;
}

export interface Command {
    name: string;

    data: SlashCommandBuilder | { toJSON: () => unknown; name: string; description: string };

    execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void>;
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
    for (const CommandClass of commandConstructors) {
        try {
            const command = new CommandClass();
            if (command.name && command.data && typeof command.execute === "function") {
                commandRegistry.register(command);
            }
        } catch (fileError) {
            const commandName = CommandClass.name || "unknown";
            logger.warn(
                logModules.Command,
                `Failed to load command ${commandName}: ${fileError instanceof Error ? fileError.message : fileError}`,
            );
        }
    }
}

/** One line naming every loaded command with its subcommands, e.g. "3 commands: link (self, force, reset), setup". */
export function describeLoadedCommands(registry: CommandRegistry = commandRegistry): string {
    const names = registry.getAll().map((cmd) => {
        const data = cmd.data.toJSON() as { options?: { type: number; name: string }[] };
        const subcommands = data.options?.filter((opt) => opt.type === 1).map((opt) => opt.name) ?? [];
        return subcommands.length > 0 ? `${cmd.name} (${subcommands.join(", ")})` : cmd.name;
    });
    return `${registry.size} commands: ${names.join(", ")}`;
}

loadCommands();
