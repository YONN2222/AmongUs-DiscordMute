import {
    ActionRowBuilder,
    ButtonBuilder,
    type ButtonInteraction,
    ButtonStyle,
    type ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import { type Locale, localeFrom, localized, type MessageKey, t } from "../../i18n";
import { logger, logModules } from "../../Logging/logger";
import { ContainerBuilder } from "../../Utils/ContainerBuilder";
import type { Command, CommandContext } from "../Command";

export const LINK_SELF_UNLINK_BUTTON_ID = "link-self-unlink";

export async function handleLinkSelfUnlinkButton(interaction: ButtonInteraction, ctx: CommandContext): Promise<void> {
    if (!interaction.guildId) return;
    const locale = localeFrom(interaction.locale);

    const removed = await ctx.linking.removeLink(interaction.guildId, interaction.user.id);

    const container = removed
        ? new ContainerBuilder()
              .title(t(locale, "link.reset.title"), "✅")
              .divider()
              .text(t(locale, "link.reset.selfDone"))
              .success()
        : new ContainerBuilder()
              .title(t(locale, "link.reset.noneTitle"), "⚠️")
              .text(t(locale, "link.reset.selfNone"))
              .warning();

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
    });
}

async function replyEphemeral(interaction: ChatInputCommandInteraction, container: ContainerBuilder) {
    await interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
    });
}

export class LinkCommand implements Command {
    name = "link";

    data = localized(new SlashCommandBuilder().setName("link"), "link.description")
        .addSubcommand((sub) => localized(sub.setName("self"), "link.self.description"))
        .addSubcommand((sub) =>
            localized(sub.setName("force"), "link.force.description")
                .addUserOption((option) =>
                    localized(option.setName("user"), "link.force.user.description").setRequired(true),
                )
                .addStringOption((option) =>
                    localized(option.setName("display-name"), "link.force.displayName.description").setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            localized(sub.setName("reset"), "link.reset.description").addUserOption((option) =>
                localized(option.setName("user"), "link.reset.user.description").setRequired(false),
            ),
        );

    async execute(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
        if (!interaction.guildId) {
            const locale = localeFrom(interaction.locale);
            await replyEphemeral(
                interaction,
                new ContainerBuilder()
                    .title(t(locale, "link.failed.title"), "⚠️")
                    .text(t(locale, "link.guildOnly"))
                    .warning(),
            );
            return;
        }

        switch (interaction.options.getSubcommand()) {
            case "self":
                return this.executeSelf(interaction, ctx);
            case "force":
                return this.executeForce(interaction, ctx);
            case "reset":
                return this.executeReset(interaction, ctx);
        }
    }

    private async executeSelf(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
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

    private async executeForce(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
        if (!this.hasManageGuild(interaction)) {
            await this.replyMissingPermission(interaction);
            return;
        }

        const locale = localeFrom(interaction.locale);
        const user = interaction.options.getUser("user", true);
        const displayName = interaction.options.getString("display-name", true);
        const guildId = interaction.guildId as string;

        try {
            await ctx.linking.forceLink(guildId, user.id, displayName);

            await replyEphemeral(
                interaction,
                new ContainerBuilder()
                    .title(t(locale, "link.force.title"), "✅")
                    .divider()
                    .text(t(locale, "link.force.body", { user: user.toString(), name: displayName }))
                    .success(),
            );
        } catch (error) {
            logger.error(logModules.Command, `Failed to force-link ${user.id} to ${displayName}`, error);
            await this.replyError(interaction, locale, "link.force.error");
        }
    }

    private async executeReset(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const guildId = interaction.guildId as string;
        const locale = localeFrom(interaction.locale);

        if (targetUser.id !== interaction.user.id && !this.hasManageGuild(interaction)) {
            await this.replyMissingPermission(interaction);
            return;
        }

        try {
            const removed = await ctx.linking.removeLink(guildId, targetUser.id);
            const params = { user: targetUser.toString() };

            const container = removed
                ? new ContainerBuilder()
                      .title(t(locale, "link.reset.title"), "✅")
                      .divider()
                      .text(t(locale, "link.reset.userDone", params))
                      .success()
                : new ContainerBuilder()
                      .title(t(locale, "link.reset.noneTitle"), "⚠️")
                      .text(t(locale, "link.reset.userNone", params))
                      .warning();

            await replyEphemeral(interaction, container);
        } catch (error) {
            logger.error(logModules.Command, `Failed to reset link for ${targetUser.id}`, error);
            await this.replyError(interaction, locale, "link.reset.error");
        }
    }

    private async replyError(interaction: ChatInputCommandInteraction, locale: Locale, key: MessageKey) {
        await replyEphemeral(
            interaction,
            new ContainerBuilder().title(t(locale, "link.error.title"), "❌").text(t(locale, key)).error(),
        );
    }

    private hasManageGuild(interaction: ChatInputCommandInteraction): boolean {
        const permissions = interaction.memberPermissions;
        return (
            permissions !== null &&
            (permissions.has(PermissionFlagsBits.ManageGuild) || permissions.has(PermissionFlagsBits.Administrator))
        );
    }

    private async replyMissingPermission(interaction: ChatInputCommandInteraction) {
        const locale = localeFrom(interaction.locale);
        await replyEphemeral(
            interaction,
            new ContainerBuilder()
                .title(t(locale, "link.permission.title"), "⚠️")
                .text(t(locale, "link.permission.body"))
                .warning(),
        );
    }
}
