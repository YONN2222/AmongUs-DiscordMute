import {
    ActionRowBuilder,
    type AnySelectMenuInteraction,
    type APIMessageTopLevelComponent,
    type ButtonInteraction,
    MessageFlags,
    ModalBuilder,
    type ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import { type ComponentInteraction, registerComponent } from "../Cluster/ComponentRouter";
import type { CommandContext } from "../Commands/Command";
import { escapeName } from "../Game/PlayerNames";
import { type Locale, localeFrom, t } from "../I18n/Index";
import { BlockedUserError } from "../Linking/LinkingService";
import { unlinkSelf } from "../Linking/SelfUnlink";
import { startSelfLink } from "../Linking/StartSelfLink";
import { logger, logModules } from "../Logging/Logger";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { canManageServer } from "../Utils/Permissions";
import { PAGE_SIZE, pageCount, renderLinkOverview } from "./RenderLinkOverview";

export const LINK_OVERVIEW_PREFIX = "lo";
export const FORCE_MODAL_ID = "lo:force";

const NAME_MAX = 64;
const USER_REFERENCE = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/;

type PageInteraction = ButtonInteraction | AnySelectMenuInteraction;

const ephemeral = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

const topLevel = (components: unknown[]) => components as APIMessageTopLevelComponent[];

async function replyText(interaction: ComponentInteraction, container: ContainerBuilder) {
    await interaction.reply({ flags: ephemeral, components: [container] });
}

async function replyMissingPermission(interaction: ComponentInteraction): Promise<void> {
    const locale = localeFrom(interaction.locale);
    await replyText(
        interaction,
        new ContainerBuilder()
            .title(t(locale, "error.title"))
            .text(t(locale, "error.missingPermission"))
            .footer()
            .warning(),
    );
}

async function pageComponents(interaction: PageInteraction, ctx: CommandContext, requested: number) {
    const guildId = interaction.guildId as string;
    const total = await ctx.linking.countLinks(guildId);
    const page = Math.min(Math.max(0, requested), pageCount(total) - 1);
    const entries = await ctx.linking.listLinkPage(guildId, page * PAGE_SIZE, PAGE_SIZE);
    return renderLinkOverview({
        entries,
        total,
        page,
        locale: localeFrom(interaction.locale),
        mode: "ephemeral",
        isAdmin: canManageServer(interaction.memberPermissions),
    });
}

async function showPage(interaction: PageInteraction, ctx: CommandContext, requested: number): Promise<void> {
    const components = await pageComponents(interaction, ctx, requested);
    await interaction.reply({ flags: ephemeral, components: topLevel(components) });
}

async function updatePage(interaction: PageInteraction, ctx: CommandContext, requested: number): Promise<void> {
    const components = await pageComponents(interaction, ctx, requested);
    await interaction.update({ flags: MessageFlags.IsComponentsV2, components: topLevel(components) });
}

async function adminUnlink(interaction: AnySelectMenuInteraction, ctx: CommandContext, page: number): Promise<void> {
    const guildId = interaction.guildId as string;
    for (const discordId of interaction.values) {
        await ctx.linking.removeLink(guildId, discordId, interaction.user.id);
    }
    await updatePage(interaction, ctx, page);
}

async function showForceModal(interaction: ButtonInteraction): Promise<void> {
    const locale = localeFrom(interaction.locale);
    const input = (id: string, label: string, max: number) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId(id)
                .setLabel(label)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(max),
        );
    await interaction.showModal(
        new ModalBuilder()
            .setCustomId(FORCE_MODAL_ID)
            .setTitle(t(locale, "overview.force.title"))
            .addComponents(
                input("user", t(locale, "overview.force.userLabel"), 40),
                input("name", t(locale, "overview.force.nameLabel"), NAME_MAX),
            ),
    );
}

function parseUserId(text: string): string | null {
    const match = USER_REFERENCE.exec(text.trim());
    return match ? (match[1] ?? match[2]) : null;
}

async function replyError(interaction: ModalSubmitInteraction, locale: Locale, text: string): Promise<void> {
    await replyText(interaction, new ContainerBuilder().title(t(locale, "error.title")).text(text).footer().warning());
}

async function submitForce(interaction: ModalSubmitInteraction, ctx: CommandContext): Promise<void> {
    const locale = localeFrom(interaction.locale);
    const guildId = interaction.guildId as string;
    const name = interaction.fields.getTextInputValue("name").trim();
    if (name.length < 1 || name.length > NAME_MAX) {
        await replyError(interaction, locale, t(locale, "overview.force.invalidName"));
        return;
    }
    const userId = parseUserId(interaction.fields.getTextInputValue("user"));
    const member = userId ? await interaction.guild?.members.fetch(userId).catch(() => null) : null;
    if (!member) {
        await replyError(interaction, locale, t(locale, "overview.force.unknownUser"));
        return;
    }

    try {
        await ctx.linking.forceLink(guildId, member.id, name, interaction.user.id);
    } catch (error) {
        if (!(error instanceof BlockedUserError)) throw error;
        logger.info(logModules.Link, `Refused to force-link blocked user ${member.id}`);
        await replyError(interaction, locale, t(locale, "link.force.blocked"));
        return;
    }
    await replyText(
        interaction,
        new ContainerBuilder()
            .title(t(locale, "link.force.title"))
            .divider()
            .text(t(locale, "link.force.body", { user: member.toString(), name: escapeName(name) }))
            .footer()
            .success(),
    );
}

function pageArgument(customId: string): number {
    const value = Number.parseInt(customId.split(":")[2] ?? "", 10);
    return Number.isNaN(value) ? 0 : value;
}

async function handleAdmin(interaction: ComponentInteraction, ctx: CommandContext, action: string): Promise<void> {
    if (!canManageServer(interaction.memberPermissions)) {
        await replyMissingPermission(interaction);
        return;
    }
    if (action === "admin-unlink" && interaction.isStringSelectMenu()) {
        await adminUnlink(interaction, ctx, pageArgument(interaction.customId));
    } else if (action === "admin-force" && interaction.isButton()) {
        await showForceModal(interaction);
    } else if (action === "force" && interaction.isModalSubmit()) {
        await submitForce(interaction, ctx);
    }
}

async function handleLinkOverview(interaction: ComponentInteraction, ctx: CommandContext): Promise<void> {
    if (!interaction.guildId) return;
    const action = interaction.customId.split(":")[1] ?? "";
    if (action.startsWith("admin-") || action === "force") return handleAdmin(interaction, ctx, action);
    if (!interaction.isButton()) return;

    switch (action) {
        case "link":
            return startSelfLink(interaction, ctx);
        case "unlink":
            return unlinkSelf(interaction, ctx);
        case "more":
            return showPage(interaction, ctx, 0);
        case "page":
            return updatePage(interaction, ctx, pageArgument(interaction.customId));
    }
}

export function registerLinkOverviewComponents(): void {
    registerComponent(LINK_OVERVIEW_PREFIX, handleLinkOverview);
}
