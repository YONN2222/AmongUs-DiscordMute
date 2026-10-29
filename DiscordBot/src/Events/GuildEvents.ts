import type { GuildSettings } from "../Settings/GuildSettings";

export type GuildEvent = {
    type: "settings-changed";
    guildId: string;
    actorId: string;
    paths: string[];
    before: GuildSettings;
    after: GuildSettings;
};

export interface GuildEventSink {
    emit(event: GuildEvent): void;
}
