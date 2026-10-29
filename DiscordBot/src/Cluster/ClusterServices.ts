import type { Client } from "discord.js";
import type { Database } from "../Data/Database";
import { GuildEventBus } from "../Events/GuildEvents";
import { MatchSummary } from "../Game/MatchSummary";
import { NicknameSync } from "../Game/NicknameSync";
import { StatusMessage } from "../Game/StatusMessage";
import type { Locale } from "../I18n/Index";
import { LinkOverviewPublisher } from "../LinkOverview/LinkOverviewPublisher";
import { LogChannelWriter } from "../LogChannel/LogChannelWriter";
import { type ClusterMetrics, instrumentVoiceAdapter } from "../Metrics/ClusterMetrics";
import { MuteService } from "../Mute/MuteService";
import { createVoiceTargetResolver } from "../Mute/VoiceTargetResolver";
import { SettingsService } from "../Settings/SettingsService";
import { cachedGuildIds } from "./CachedGuildIds";
import { DiscordVoiceAdapter } from "./DiscordVoiceAdapter";
import type { HostedCluster } from "./HostedCluster";
import { createDiscordMessagePort, type MessagePort } from "./MessagePort";

export interface ClusterServicesDeps {
    db: Database;
    client: Client;
    metrics: ClusterMetrics;
    /** Set only in hosted mode. */
    hosted: HostedCluster | undefined;
    /** The fallback voice channels from config.json; hosted servers pick theirs in /setup instead. */
    selfHostChannelIds: string[];
}

/** The feature services of one cluster, wired to the guild event bus. */
export interface ClusterServices {
    settings: SettingsService;
    events: GuildEventBus;
    guildLanguage: (guildId: string) => Promise<Locale>;
    messagePort: MessagePort;
    logWriter: LogChannelWriter;
    overview: LinkOverviewPublisher;
    status: StatusMessage;
    nicknameSync: NicknameSync;
    mute: MuteService;
}

/** Builds the services in a fixed order: event handlers run in the order they are registered here. */
export function createClusterServices({
    db,
    client,
    metrics,
    hosted,
    selfHostChannelIds,
}: ClusterServicesDeps): ClusterServices {
    const events = new GuildEventBus();
    const settings = new SettingsService(db.settings, events);
    metrics.attachFeatureSource({
        guildIds: () => cachedGuildIds(client),
        settings: (guildId) => settings.get(guildId),
    });
    const guildLanguage = (guildId: string) => settings.get(guildId).then((s) => s.language);
    const messagePort = createDiscordMessagePort(client);
    const logWriter = new LogChannelWriter({ port: messagePort, settings });
    events.on((event) => logWriter.handle(event));
    const overview = new LinkOverviewPublisher({
        port: messagePort,
        links: db.links,
        pending: db.pendingLinks,
        tracked: db.trackedMessages,
        settings,
    });
    events.on((event) => overview.handle(event));
    const status = new StatusMessage({
        port: messagePort,
        tracked: db.trackedMessages,
        links: db.links,
        settings,
    });
    events.on((event) => status.handle(event));
    const summary = new MatchSummary({
        port: messagePort,
        tracked: db.trackedMessages,
        links: db.links,
        settings,
    });
    events.on((event) => summary.handle(event));
    const voice = new DiscordVoiceAdapter(client);
    const nicknameSync = new NicknameSync({
        adapter: voice,
        ledger: db.nicknameLedger,
        links: db.links,
        settings,
        events,
    });
    events.on((event) => nicknameSync.handle(event));
    const mute = new MuteService({
        events,
        voice: instrumentVoiceAdapter(voice, metrics),
        settings,
        links: db.links,
        ledger: db.muteLedger,
        resolveTarget: createVoiceTargetResolver({
            links: db.links,
            memberVoiceChannel: (guildId, discordId) => voice.voiceChannelOf(guildId, discordId),
            // Hosted servers pick their fallback channels in /setup; self-host keeps them in config.json.
            fallbackChannelIds: hosted
                ? async (guildId) => (await settings.get(guildId)).voiceChannelIds
                : async () => selfHostChannelIds,
            isUserBlocked: hosted ? (userId) => hosted.blocks.isUserBlocked(userId) : undefined,
            localeOf: guildLanguage,
        }),
    });
    return { settings, events, guildLanguage, messagePort, logWriter, overview, status, nicknameSync, mute };
}
