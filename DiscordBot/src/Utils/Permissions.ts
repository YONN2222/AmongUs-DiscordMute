import { PermissionFlagsBits, type PermissionsBitField } from "discord.js";

/** True for members with Manage Server or Administrator; a missing permission set (DMs) never qualifies. */
export function canManageServer(permissions: Readonly<PermissionsBitField> | null): boolean {
    return (
        permissions !== null &&
        (permissions.has(PermissionFlagsBits.ManageGuild) || permissions.has(PermissionFlagsBits.Administrator))
    );
}
