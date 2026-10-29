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

const VOICE_TYPES: ReadonlySet<ChannelType> = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const VOICE_CONTROL_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.MuteMembers,
    PermissionFlagsBits.DeafenMembers,
];

/** Whether the bot can mute and deafen members in the voice channel; `null` means it can. */
export function checkVoiceChannelAccess(
    type: ChannelType,
    permissions: Readonly<PermissionsBitField> | null,
): MessageKey | null {
    if (!VOICE_TYPES.has(type)) return "setup.error.notVoice";
    return permissions?.has(VOICE_CONTROL_PERMISSIONS) ? null : "setup.error.voicePermissions";
}
