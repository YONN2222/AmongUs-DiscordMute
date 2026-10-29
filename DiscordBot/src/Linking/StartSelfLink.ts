import {
    ActionRowBuilder,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    type ChatInputCommandInteraction,
    MessageFlags,
} from "discord.js";
import type { CommandContext } from "../Commands/Command";
import { localeFrom, t } from "../I18n/Index";
import { logger, logModules } from "../Logging/Logger";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { LINK_SELF_UNLINK_BUTTON_ID } from "./SelfUnlink";

type SelfLinkInteraction = ChatInputCommandInteraction | ButtonInteraction;

async function replyEphemeral(interaction: SelfLinkInteraction, container: ContainerBuilder) {
    await interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
    });
}

/** Starts linking the clicking user: replies with the codes, or with the unlink option when already linked. */
export async function startSelfLink(interaction: SelfLinkInteraction, ctx: CommandContext): Promise<void> {
    const guildId = interaction.guildId as string;
    const locale = localeFrom(interaction.locale);

    const existing = await ctx.linking.getLink(guildId, interaction.user.id);
    if (existing) {
        const container = new ContainerBuilder()
            .title(t(locale, "link.alreadyLinked.title"), "🔗")
            .divider()
            .text(t(locale, "link.alreadyLinked.body", { name: existing.accountName }))
            .info();

        const unlinkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(LINK_SELF_UNLINK_BUTTON_ID)
                .setLabel(t(locale, "link.unlinkButton"))
                .setStyle(ButtonStyle.Danger),
        );

        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container, unlinkRow],
        });
        return;
    }
    const { phrase, quickChatCode, quickChatLabels } = await ctx.linking.createPendingLink(
        guildId,
        interaction.user.id,
    );
    ctx.events.emit({ type: "pending-changed", guildId, discordId: interaction.user.id });
    const pluginReady = await ctx.pushLinkPending(guildId, phrase, quickChatCode, interaction.user.id);
    if (!pluginReady) {
        logger.warn(logModules.Command, "Plugin is not connected for this server; cannot send pending link");

        await replyEphemeral(
            interaction,
            new ContainerBuilder()
                .title(t(locale, "link.failed.title"), "⚠️")
                .divider()
                .text(t(locale, "link.pluginNotReady"))
                .warning(),
        );
        return;
    }

    const container = new ContainerBuilder()
        .title(t(locale, "link.self.title"), "🔗")
        .divider()
        .text(
            t(locale, "link.self.instructions", {
                phrase,
                quickChat1: quickChatLabels[0],
                quickChat2: quickChatLabels[1],
            }),
        )
        .info();

    logger.debug(logModules.Command, `Link phrase sent to ${interaction.user.id}: "${phrase}"`);

    await replyEphemeral(interaction, container);

    await ctx.linking.attachInteractionResponse(
        guildId,
        interaction.user.id,
        interaction.applicationId,
        interaction.token,
        locale,
    );
}
