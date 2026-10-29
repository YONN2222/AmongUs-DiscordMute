import {
    ActionRowBuilder,
    type APIMessageTopLevelComponent,
    type ButtonInteraction,
    type Guild,
    type GuildBasedChannel,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import { type ComponentInteraction, registerComponent } from "../Cluster/componentRouter";
import type { CommandContext } from "../commands/Command";
import { type Locale, localeFrom, type MessageKey, t } from "../i18n";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { canManageServer } from "../Utils/permissions";
import { applySetupInput, DELAY_FIELDS, DELAYS_MODAL_FIELD, setupPageOf } from "./applySetupInput";
import { checkChannelAccess } from "./channelAccess";
import { renderSetupPanel, SETUP_PAGES, SETUP_PREFIX, type SetupPage } from "./renderSetupPanel";

const EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const MANAGE_MESSAGES_FIELDS = new Set(["linkOverview.channelId", "status.channelId"]);

const topLevel = (components: unknown[]) => components as APIMessageTopLevelComponent[];

export async function buildSetupPanel(
    ctx: CommandContext,
    guildId: string,
    page: SetupPage,
    locale: Locale,
): Promise<APIMessageTopLevelComponent[]> {
    const [settings, connected] = await Promise.all([ctx.settings.get(guildId), ctx.isPluginConnected(guildId)]);
    return topLevel(renderSetupPanel(settings, page, locale, connected));
}

export async function replyEphemeralText(
    interaction: { reply: ComponentInteraction["reply"] },
    locale: Locale,
    key: MessageKey,
): Promise<void> {
    await interaction.reply({
        flags: EPHEMERAL,
        components: [new ContainerBuilder().title(t(locale, "error.title"), null).text(t(locale, key)).warning()],
    });
}

async function showPanel(interaction: ComponentInteraction, ctx: CommandContext, page: SetupPage): Promise<void> {
    const components = await buildSetupPanel(ctx, interaction.guildId as string, page, localeFrom(interaction.locale));
    if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
        await interaction.reply({ flags: EPHEMERAL, components });
        return;
    }
    await (interaction as ButtonInteraction).update({ flags: MessageFlags.IsComponentsV2, components });
}

async function showDelaysModal(interaction: ButtonInteraction, ctx: CommandContext): Promise<void> {
    const locale = localeFrom(interaction.locale);
    const settings = await ctx.settings.get(interaction.guildId as string);
    const input = (name: (typeof DELAY_FIELDS)[number]) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId(name)
                .setLabel(t(locale, `setup.delays.${name}`))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(5)
                .setValue(String(settings.delaysMs[name] / 1000)),
        );
    await interaction.showModal(
        new ModalBuilder()
            .setCustomId(`${SETUP_PREFIX}:${DELAYS_MODAL_FIELD}`)
            .setTitle(t(locale, "setup.delays.title"))
            .addComponents(DELAY_FIELDS.map(input)),
    );
}

async function resolveChannel(guild: Guild, id: string): Promise<GuildBasedChannel | null> {
    return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

/** The first problem that stops the bot from using the chosen channels, or null when all are fine. */
async function channelProblem(
    interaction: ComponentInteraction,
    field: string,
    channelIds: string[],
): Promise<MessageKey | null> {
    const guild = interaction.guild;
    if (!guild) return "setup.error.unknownChannel";
    const me = guild.members.me ?? (await guild.members.fetchMe());
    for (const id of channelIds) {
        const channel = await resolveChannel(guild, id);
        if (!channel) return "setup.error.unknownChannel";
        const problem = checkChannelAccess(channel.type, channel.permissionsFor(me), MANAGE_MESSAGES_FIELDS.has(field));
        if (problem) return problem;
    }
    return null;
}

function rawValues(interaction: ComponentInteraction): string[] {
    if (interaction.isModalSubmit()) {
        return DELAY_FIELDS.map((name) => interaction.fields.getTextInputValue(name));
    }
    return interaction.isButton() ? [] : interaction.values;
}

async function handleSetup(interaction: ComponentInteraction, ctx: CommandContext): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const locale = localeFrom(interaction.locale);
    if (!canManageServer(interaction.memberPermissions)) {
        await replyEphemeralText(interaction, locale, "error.missingPermission");
        return;
    }
    const field = interaction.customId.slice(SETUP_PREFIX.length + 1);

    if (field === "page" && interaction.isStringSelectMenu()) {
        const page = SETUP_PAGES.find((candidate) => candidate === interaction.values[0]);
        if (page) await showPanel(interaction, ctx, page);
        return;
    }
    if (field === "delays" && interaction.isButton()) {
        await showDelaysModal(interaction, ctx);
        return;
    }

    const values = rawValues(interaction);
    if (interaction.isChannelSelectMenu()) {
        const problem = await channelProblem(interaction, field, values);
        if (problem) {
            await replyEphemeralText(interaction, locale, problem);
            return;
        }
    }
    const result = applySetupInput(field, values, await ctx.settings.get(guildId));
    if ("error" in result) {
        await replyEphemeralText(interaction, locale, result.error);
        return;
    }
    await ctx.settings.update(guildId, interaction.user.id, result.patch);
    await showPanel(interaction, ctx, setupPageOf(field));
}

export function registerSetupComponents(): void {
    registerComponent(SETUP_PREFIX, handleSetup);
}
