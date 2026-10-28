import type { Client, Guild, VoiceState } from "discord.js";
import type { VoiceAdapter, VoiceMember } from "../Mute/MuteService";

function toVoiceMember(state: VoiceState): VoiceMember {
    return { discordId: state.id, serverMuted: state.serverMute === true };
}

/** Reads voice channels from the gateway-fed voice state cache, so listing members needs no REST call. */
export class DiscordVoiceAdapter implements VoiceAdapter {
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

    async setServerMute(guildId: string, discordId: string, mute: boolean): Promise<void> {
        await this.guild(guildId).members.edit(discordId, { mute });
    }

    async voiceChannelOf(guildId: string, discordId: string): Promise<string | null> {
        return this.voiceState(guildId, discordId)?.channelId ?? null;
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
