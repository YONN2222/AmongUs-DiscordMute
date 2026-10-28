import { type Client, Events } from "discord.js";
import type { MuteService } from "../Mute/MuteService";

/** A member who left voice while muted is unmuted once they join a voice channel again outside a game. */
export function registerVoiceRejoin(client: Client, mute: Pick<MuteService, "releaseIfIdle">): void {
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
        if (!newState.channelId || newState.channelId === oldState.channelId) return;
        void mute.releaseIfIdle(newState.guild.id, newState.id);
    });
}
