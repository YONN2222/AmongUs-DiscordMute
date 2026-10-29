import type { Client, Guild, VoiceState } from "discord.js";
import type { NicknameAdapter } from "../Game/NicknameSync";
import type { VoiceAdapter, VoiceMember, VoiceStatePatch } from "../Mute/MuteService";

function toVoiceMember(state: VoiceState): VoiceMember {
    return {
        discordId: state.id,
        serverMuted: state.serverMute === true,
        serverDeafened: state.serverDeaf === true,
        isBot: state.member?.user.bot === true,
    };
}

const DISCORD_UNKNOWN_MEMBER = 10007;

function isUnknownMember(err: unknown): boolean {
    return typeof err === "object" && err !== null && "code" in err && err.code === DISCORD_UNKNOWN_MEMBER;
}

/** Reads voice channels from the gateway-fed voice state cache, so listing members needs no REST call. */
export class DiscordVoiceAdapter implements VoiceAdapter, NicknameAdapter {
    constructor(private readonly client: Client) {}

    async membersInChannel(guildId: string, channelId: string): Promise<VoiceMember[]> {
        return this.guild(guildId)
            .voiceStates.cache.filter((state) => state.channelId === channelId)
            .map(toVoiceMember);
    }

    async findVoiceMember(guildId: string, discordId: string): Promise<VoiceMember | null> {
        const state = this.voiceState(guildId, discordId);
        return state ? toVoiceMember(state) : null;
    }

    async setVoiceState(guildId: string, discordId: string, patch: VoiceStatePatch): Promise<void> {
        await this.guild(guildId).members.edit(discordId, patch);
    }

    async voiceChannelOf(guildId: string, discordId: string): Promise<string | null> {
        return this.voiceState(guildId, discordId)?.channelId ?? null;
    }

    async nicknameOf(guildId: string, discordId: string): Promise<{ nick: string | null } | null> {
        const guild = this.guild(guildId);
        const cached = guild.members.cache.get(discordId);
        if (cached) return { nick: cached.nickname };
        try {
            return { nick: (await guild.members.fetch(discordId)).nickname };
        } catch (err) {
            if (isUnknownMember(err)) return null;
            throw err;
        }
    }

    async setNickname(guildId: string, discordId: string, nick: string | null): Promise<void> {
        await this.guild(guildId).members.edit(discordId, { nick });
    }

    private voiceState(guildId: string, discordId: string): VoiceState | null {
        const state = this.guild(guildId).voiceStates.cache.get(discordId);
        return state?.channelId ? state : null;
    }

    private guild(guildId: string): Guild {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) throw new Error(`Guild ${guildId} is not available on this cluster`);
        return guild;
    }
}
