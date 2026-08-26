import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    type ButtonInteraction,
    type ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import { logger, logModules } from "../../Logging/logger";
import { ContainerBuilder } from "../../Utils/ContainerBuilder";
import { linkingService } from "../../Utils/LinkingService";
import { pluginSocket } from "../../Utils/PluginSocket";
import type { Command } from "../Command";

export const LINK_SELF_UNLINK_BUTTON_ID = "link-self-unlink";

export async function handleLinkSelfUnlinkButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) return;

    const removed = await linkingService.removeLink(interaction.guildId, interaction.user.id);

    const container = removed
        ? new ContainerBuilder().title("Link Reset", "✅").divider().text("You are no longer linked.").success()
        : new ContainerBuilder().title("Link Reset", "⚠️").text("You were not linked to begin with.").warning();

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
    });
}
export class LinkCommand implements Command {
    name = "link";

    data = new SlashCommandBuilder()
        .setName("link")
        .setDescription("Link, force-link, or unlink a Discord account and an Among Us account.")
        .addSubcommand((sub) =>
            sub.setName("self").setDescription("Links your Discord account to your Among Us account name."),
        )
        .addSubcommand((sub) =>
            sub
                .setName("force")
                .setDescription("Manually links a Discord user to an Among Us display name.")
                .addUserOption((option) =>
                    option.setName("user").setDescription("The Discord user to link").setRequired(true),
                )
                .addStringOption((option) =>
                    option.setName("display-name").setDescription("The Among Us display name").setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName("reset")
                .setDescription("Unlinks a Discord account. Leave 'user' empty to unlink yourself.")
                .addUserOption((option) =>
                    option
                        .setName("user")
                        .setDescription("The Discord user to unlink (requires Manage Server)")
                        .setRequired(false),
                ),
        );

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [
                    new ContainerBuilder()
                        .title("Link Failed", "⚠️")
                        .text("This command can only be used inside a server.")
                        .warning(),
                ],
            });
            return;
        }

        switch (interaction.options.getSubcommand()) {
            case "self":
                return this.executeSelf(interaction);
            case "force":
                return this.executeForce(interaction);
            case "reset":
                return this.executeReset(interaction);
        }
    }

    private async executeSelf(interaction: ChatInputCommandInteraction) {
        const guildId = interaction.guildId as string;

        const existing = await linkingService.getLink(guildId, interaction.user.id);
        if (existing) {
            const container = new ContainerBuilder()
                .title("Already Linked", "🔗")
                .divider()
                .text(`You're linked to the Among Us account **${existing.accountName}**.`)
                .info();

            const unlinkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(LINK_SELF_UNLINK_BUTTON_ID)
                    .setLabel("Unlink")
                    .setStyle(ButtonStyle.Danger),
            );

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container, unlinkRow],
            });
            return;
        }
        const { phrase, quickChatCode, quickChatLabels } = linkingService.createPendingLink(
            guildId,
            interaction.user.id,
        );
        const pluginReady = pluginSocket.sendLinkPending(phrase, quickChatCode, interaction.user.id);
        if (!pluginReady) {
            logger.warn(logModules.Command, "Plugin is not connected via WebSocket; cannot send pending link");

            const container = new ContainerBuilder()
                .title("Link Failed", "⚠️")
                .divider()
                .text(
                    "The Among Us plugin did not accept the pending link request.\n\n" +
                        "Start the game with the plugin loaded and run `/link self` again.",
                )
                .warning();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
            return;
        }

        const container = new ContainerBuilder()
            .title("Link Account", "🔗")
            .divider()
            .text(
                "Open **Free Chat** in Among Us while in a lobby and type this phrase exactly:\n\n" +
                    `**\`${phrase}\`**\n\n` +
                    "No Free Chat access? Send these two Quick Chat phrases as two separate messages, in any order, within 20 seconds:\n\n" +
                    `**${quickChatLabels[0]}** and **${quickChatLabels[1]}**\n\n` +
                    "This code expires in **5 minutes**.",
            )
            .info();

        logger.debug(logModules.Command, `Link phrase sent to ${interaction.user.id}: "${phrase}"`);

        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
        });

        linkingService.attachInteractionResponse(
            guildId,
            interaction.user.id,
            interaction.applicationId,
            interaction.token,
        );
    }

    private async executeForce(interaction: ChatInputCommandInteraction) {
        if (!this.hasManageGuild(interaction)) {
            await this.replyMissingPermission(interaction);
            return;
        }

        const user = interaction.options.getUser("user", true);
        const displayName = interaction.options.getString("display-name", true);
        const guildId = interaction.guildId as string;

        try {
            await linkingService.forceLink(guildId, user.id, displayName);

            const container = new ContainerBuilder()
                .title("Force Link Complete", "✅")
                .divider()
                .text(`**Discord User:** ${user.toString()}\n**Among Us Name:** \`${displayName}\``)
                .success();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
        } catch (error) {
            logger.error(logModules.Command, `Failed to force-link ${user.id} to ${displayName}`, error);

            const container = new ContainerBuilder()
                .title("Link Error", "❌")
                .text("An error occurred while manually linking the account.")
                .error();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
        }
    }

    private async executeReset(interaction: ChatInputCommandInteraction) {
        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const guildId = interaction.guildId as string;

        if (targetUser.id !== interaction.user.id && !this.hasManageGuild(interaction)) {
            await this.replyMissingPermission(interaction);
            return;
        }

        try {
            const removed = await linkingService.removeLink(guildId, targetUser.id);

            const container = removed
                ? new ContainerBuilder()
                      .title("Link Reset", "✅")
                      .divider()
                      .text(`${targetUser.toString()} is no longer linked to an Among Us account.`)
                      .success()
                : new ContainerBuilder()
                      .title("Link Reset", "⚠️")
                      .text(`${targetUser.toString()} was not linked to begin with.`)
                      .warning();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
        } catch (error) {
            logger.error(logModules.Command, `Failed to reset link for ${targetUser.id}`, error);

            const container = new ContainerBuilder()
                .title("Link Error", "❌")
                .text("An error occurred while unlinking the account.")
                .error();

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
            });
        }
    }

    private hasManageGuild(interaction: ChatInputCommandInteraction): boolean {
        const permissions = interaction.memberPermissions;
        return (
            permissions !== null && (permissions.has(PermissionFlagsBits.ManageGuild) || permissions.has(PermissionFlagsBits.Administrator))
        );
    }

    private async replyMissingPermission(interaction: ChatInputCommandInteraction) {
        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [
                new ContainerBuilder()
                    .title("Missing Permission", "⚠️")
                    .text("You need the **Manage Server** permission to do this for another user.")
                    .warning(),
            ],
        });
    }
}
