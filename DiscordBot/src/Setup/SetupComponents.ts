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
import { type ComponentInteraction, registerComponent } from "../Cluster/ComponentRouter";
import type { CommandContext } from "../Commands/Command";
import { type Locale, localeFrom, type MessageKey, t } from "../I18n/Index";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { canManageServer } from "../Utils/Permissions";
import {
    applySetupInput,
    DELAY_FIELDS,
    DELAYS_MODAL_FIELD,
    MS_PER_SECOND,
    setupPageOf,
    VOICE_CHANNELS_FIELD,
} from "./ApplySetupInput";
import { checkChannelAccess, checkVoiceChannelAccess } from "./ChannelAccess";
import { renderSetupPanel, SETUP_PAGES, type SetupPage } from "./RenderSetupPanel";
import { handleSecretButton, handleSecretConfirmButton } from "./SecretPanel";
import { DELAYS_FIELD, PAGE_FIELD, SECRET_CONFIRM_FIELD, SECRET_FIELD, SETUP_PREFIX } from "./SetupIds";

const EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const MANAGE_MESSAGES_FIELDS = new Set(["linkOverview.channelId", "status.channelId"]);
const SECRET_BUTTONS = new Map([
    [SECRET_FIELD, handleSecretButton],
    [SECRET_CONFIRM_FIELD, handleSecretConfirmButton],
]);
/** Character limit of the delay inputs in the delays modal. */
const MAX_DELAY_INPUT_LENGTH = 5;

const topLevel = (components: unknown[]) => components as APIMessageTopLevelComponent[];

export async function buildSetupPanel(
    ctx: CommandContext,
    guildId: string,
    page: SetupPage,
    locale: Locale,
): Promise<APIMessageTopLevelComponent[]> {
    const [settings, connected, secret] = await Promise.all([
        ctx.settings.get(guildId),
        ctx.isPluginConnected(guildId),
        ctx.pluginSecret.secrets.get(guildId),
    ]);
    return topLevel(renderSetupPanel(settings, page, locale, connected, secret?.createdAt ?? null));
}

export async function replyEphemeralText(
    interaction: { reply: ComponentInteraction["reply"] },
    locale: Locale,
    key: MessageKey,
): Promise<void> {
    await interaction.reply({
        flags: EPHEMERAL,
        components: [new ContainerBuilder().title(t(locale, "error.title")).text(t(locale, key)).footer().warning()],
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
                .setMaxLength(MAX_DELAY_INPUT_LENGTH)
                .setValue(String(settings.delaysMs[name] / MS_PER_SECOND)),
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
        const permissions = channel.permissionsFor(me);
        const problem =
            field === VOICE_CHANNELS_FIELD
                ? checkVoiceChannelAccess(channel.type, permissions)
                : checkChannelAccess(channel.type, permissions, MANAGE_MESSAGES_FIELDS.has(field));
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

    const secretButton = SECRET_BUTTONS.get(field);
    if (secretButton && interaction.isButton()) {
        await secretButton(interaction, ctx);
        return;
    }

    if (field === PAGE_FIELD && interaction.isStringSelectMenu()) {
        const page = SETUP_PAGES.find((candidate) => candidate === interaction.values[0]);
        if (page) await showPanel(interaction, ctx, page);
        return;
    }
    if (field === DELAYS_FIELD && interaction.isButton()) {
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
