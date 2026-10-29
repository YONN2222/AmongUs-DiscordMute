import { ChannelType, PermissionFlagsBits, type PermissionsBitField } from "discord.js";
import type { MessageKey } from "../I18n/Index";

const POSTABLE_TYPES: ReadonlySet<ChannelType> = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/**
 * Whether the bot can post in the channel; `null` means it can.
 * The overview and status messages are kept up to date, so their channels also need Manage Messages.
 */
export function checkChannelAccess(
    type: ChannelType,
    permissions: Readonly<PermissionsBitField> | null,
    needsManageMessages = false,
): MessageKey | null {
    if (!POSTABLE_TYPES.has(type)) return "setup.error.channelType";
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        return "setup.error.noAccess";
    }
    if (needsManageMessages && !permissions.has(PermissionFlagsBits.ManageMessages)) {
        return "setup.error.noManageMessages";
    }
    return null;
}
