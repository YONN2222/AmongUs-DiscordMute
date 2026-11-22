import { type ButtonInteraction, MessageFlags } from "discord.js";
import type { CommandContext } from "../Commands/Command";
import { localeFrom, t } from "../I18n/Index";
import { ContainerBuilder } from "../Utils/ContainerBuilder";

const EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/** The panel's pair button: shows the Quick Chat phrases the host sends in the lobby to pair the device. */
export async function handlePairButton(interaction: ButtonInteraction, ctx: CommandContext): Promise<void> {
    const locale = localeFrom(interaction.locale);
    const guildId = interaction.guildId as string;
    const { phrases, expiresAt } = await ctx.devices.pairing.createCode(guildId, interaction.guild?.name ?? guildId);
    const container = new ContainerBuilder()
        .title(t(locale, "setup.pair.title"))
        .divider()
        .text(
            t(locale, "setup.pair.instructions", {
                phrase1: phrases[0],
                phrase2: phrases[1],
                phrase3: phrases[2],
                time: `<t:${Math.floor(expiresAt / 1000)}:R>`,
            }),
        )
        .footer()
        .info();
    await interaction.reply({ flags: EPHEMERAL, components: [container] });
}
