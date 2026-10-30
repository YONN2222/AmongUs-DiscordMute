import { ChannelType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { describe, expect, it } from "vitest";
import { checkChannelAccess, checkVoiceChannelAccess } from "../../src/Setup/ChannelAccess";

const { ViewChannel, SendMessages, ManageMessages, MuteMembers, DeafenMembers } = PermissionFlagsBits;
const perms = (...flags: bigint[]) => new PermissionsBitField(flags);

describe("checkChannelAccess", () => {
    it.each([ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildForum])(
        "refuses channel type %i",
        (type) => {
            expect(checkChannelAccess(type, perms(ViewChannel, SendMessages))).toBe("setup.error.channelType");
        },
    );

    it.each([ChannelType.GuildText, ChannelType.GuildAnnouncement])("accepts channel type %i", (type) => {
        expect(checkChannelAccess(type, perms(ViewChannel, SendMessages))).toBeNull();
    });

    it("refuses when the bot has no permissions at all", () => {
        expect(checkChannelAccess(ChannelType.GuildText, null)).toBe("setup.error.noAccess");
    });

    it("refuses a channel the bot cannot view", () => {
        expect(checkChannelAccess(ChannelType.GuildText, perms(SendMessages))).toBe("setup.error.noAccess");
    });

    it("refuses a channel the bot cannot send in", () => {
        expect(checkChannelAccess(ChannelType.GuildText, perms(ViewChannel))).toBe("setup.error.noAccess");
    });

    it("requires Manage Messages only when asked", () => {
        const noManage = perms(ViewChannel, SendMessages);

        expect(checkChannelAccess(ChannelType.GuildText, noManage, true)).toBe("setup.error.noManageMessages");
        expect(checkChannelAccess(ChannelType.GuildText, noManage, false)).toBeNull();
        expect(
            checkChannelAccess(ChannelType.GuildText, perms(ViewChannel, SendMessages, ManageMessages), true),
        ).toBeNull();
    });

    it("reports the missing access before the missing Manage Messages", () => {
        expect(checkChannelAccess(ChannelType.GuildText, perms(ManageMessages), true)).toBe("setup.error.noAccess");
    });
});

describe("checkVoiceChannelAccess", () => {
    const full = perms(ViewChannel, MuteMembers, DeafenMembers);

    it.each([ChannelType.GuildVoice, ChannelType.GuildStageVoice])("accepts voice channel type %i", (type) => {
        expect(checkVoiceChannelAccess(type, full)).toBeNull();
    });

    it.each([ChannelType.GuildText, ChannelType.GuildCategory])("refuses channel type %i", (type) => {
        expect(checkVoiceChannelAccess(type, full)).toBe("setup.error.notVoice");
    });

    it("voice channel without mute permission is rejected", () => {
        expect(checkVoiceChannelAccess(ChannelType.GuildVoice, perms(ViewChannel, DeafenMembers))).toBe(
            "setup.error.voicePermissions",
        );
        expect(checkVoiceChannelAccess(ChannelType.GuildVoice, perms(ViewChannel, MuteMembers))).toBe(
            "setup.error.voicePermissions",
        );
        expect(checkVoiceChannelAccess(ChannelType.GuildVoice, perms(MuteMembers, DeafenMembers))).toBe(
            "setup.error.voicePermissions",
        );
        expect(checkVoiceChannelAccess(ChannelType.GuildVoice, null)).toBe("setup.error.voicePermissions");
    });
});
