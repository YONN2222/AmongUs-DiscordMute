import type { AnySelectMenuInteraction, ButtonInteraction, Interaction, ModalSubmitInteraction } from "discord.js";
import type { CommandContext } from "../Commands/Command";
import { logger, logModules } from "../Logging/Logger";
import { replyGenericError } from "./ErrorReply";

export type ComponentInteraction = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

export type ComponentHandler = (interaction: ComponentInteraction, ctx: CommandContext) => Promise<void>;

const handlers = new Map<string, ComponentHandler>();

/** The prefix is the part of a custom ID before the first colon ("lo" for "lo:page:2"). */
export function componentPrefix(customId: string): string {
    const colon = customId.indexOf(":");
    return colon === -1 ? customId : customId.slice(0, colon);
}

/** Registers the handler of every component and modal whose custom ID starts with `prefix`. Registering again replaces. */
export function registerComponent(prefix: string, handler: ComponentHandler): void {
    handlers.set(prefix, handler);
}

export function isComponentInteraction(interaction: Interaction): interaction is ComponentInteraction {
    return interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit();
}

async function replyFailed(interaction: ComponentInteraction): Promise<void> {
    try {
        await replyGenericError(interaction, { icon: null, followUpWhenAnswered: true });
    } catch (replyError) {
        logger.error(logModules.Command, `Failed to send the error reply for ${interaction.customId}`, replyError);
    }
}

/** Runs the handler registered for the interaction's prefix. Resolves to false when nothing is registered. */
export async function routeComponent(interaction: ComponentInteraction, ctx: CommandContext): Promise<boolean> {
    const handler = handlers.get(componentPrefix(interaction.customId));
    if (!handler) return false;
    try {
        await handler(interaction, ctx);
    } catch (error) {
        logger.error(logModules.Command, `Component ${interaction.customId} failed for ${interaction.user.tag}`, error);
        await replyFailed(interaction);
    }
    return true;
}
