import { ActionRowBuilder, ButtonBuilder, type ButtonInteraction, ButtonStyle, MessageFlags } from "discord.js";
import type { CommandContext, HostedCommandContext } from "../Commands/Command";
import { localeFrom, t } from "../I18n/Index";
import { logger, logModules } from "../Logging/Logger";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { SETUP_PREFIX } from "./RenderSetupPanel";

export const SECRET_FIELD = "secret";
export const SECRET_CONFIRM_FIELD = "secret-confirm";

const GATEWAY_CLOSE_SECRET_CHANGED = 4001;
const DISCONNECT_REASON = "Secret changed";
const EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

export type HostedSetupContext = CommandContext & { hosted: HostedCommandContext };

const codeBlock = (text: string, language = "") => `\`\`\`${language}\n${text}\n\`\`\``;

async function replyConfirmation(interaction: ButtonInteraction): Promise<void> {
    const locale = localeFrom(interaction.locale);
    const confirm = new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:${SECRET_CONFIRM_FIELD}`)
        .setLabel(t(locale, "setup.secret.regenerate"))
        .setStyle(ButtonStyle.Danger);
    const container = new ContainerBuilder()
        .title(t(locale, "setup.secret.title"), null)
        .text(t(locale, "setup.secret.confirm"))
        .warning();
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(confirm));
    await interaction.reply({ flags: EPHEMERAL, components: [container] });
}

async function replySecret(interaction: ButtonInteraction, secret: string): Promise<void> {
    const locale = localeFrom(interaction.locale);
    const pluginConfig = `{ "mode": "hosted", "secret": "${secret}" }`;
    const container = new ContainerBuilder()
        .title(t(locale, "setup.secret.title"), null)
        .text(t(locale, "setup.secret.shownOnce"))
        .text(codeBlock(secret))
        .text(t(locale, "setup.secret.configHint"))
        .text(codeBlock(pluginConfig, "json"))
        .success();
    await interaction.reply({ flags: EPHEMERAL, components: [container] });
}

function logFailure(guildId: string, step: string, error: unknown): void {
    logger.error(logModules.Command, `Guild ${guildId}: ${step} after a secret change failed`, error);
}

/** Cleanup after the new secret is stored; a failure here must not stop the admin from seeing the secret. */
async function finishRotation(
    ctx: HostedSetupContext,
    guildId: string,
    actorId: string,
    replaced: boolean,
): Promise<void> {
    const { hosted } = ctx;
    if (replaced) {
        await hosted
            .disconnectGuild(guildId, GATEWAY_CLOSE_SECRET_CHANGED, DISCONNECT_REASON)
            .catch((error: unknown) => logFailure(guildId, "disconnecting the running games", error));
    }
    await hosted.audit
        .record({
            actorId,
            action: replaced ? "secret.regenerate" : "secret.create",
            targetType: "guild",
            targetId: guildId,
        })
        .catch((error: unknown) => logFailure(guildId, "writing the audit entry", error));
    ctx.events.emit({ type: "secret-changed", guildId, actorId, created: !replaced });
}

async function issueSecret(interaction: ButtonInteraction, ctx: HostedSetupContext): Promise<void> {
    const guildId = interaction.guildId as string;
    const actorId = interaction.user.id;
    const { secret, replaced } = await ctx.hosted.secrets.rotate(guildId, actorId);
    await finishRotation(ctx, guildId, actorId, replaced);
    await replySecret(interaction, secret);
}

/** The panel's secret button: creates the first secret, or asks before replacing an existing one. */
export async function handleSecretButton(interaction: ButtonInteraction, ctx: HostedSetupContext): Promise<void> {
    const existing = await ctx.hosted.secrets.get(interaction.guildId as string);
    if (existing) {
        await replyConfirmation(interaction);
        return;
    }
    await issueSecret(interaction, ctx);
}

/** The danger button of the confirmation: replaces the secret and disconnects the running games. */
export async function handleSecretConfirmButton(
    interaction: ButtonInteraction,
    ctx: HostedSetupContext,
): Promise<void> {
    await issueSecret(interaction, ctx);
}
