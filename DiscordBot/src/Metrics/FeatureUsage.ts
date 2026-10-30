import { DEFAULT_SETTINGS, diffSettings, type GuildSettings } from "../Settings/GuildSettings";
import { TELEMETRY_FEATURES, type TelemetryFeature } from "../Telemetry/Contract/schema";

const FEATURE_CHECKS: Record<TelemetryFeature, (settings: GuildSettings) => boolean> = {
    linkOverview: (s) => s.linkOverview.channelId !== null,
    serverLog: (s) => s.logChannelId !== null,
    voiceRules: (s) => diffSettings(DEFAULT_SETTINGS, s).some((path) => path.startsWith("voiceRules.")),
    phaseDelays: (s) => Object.values(s.delaysMs).some((ms) => ms > 0),
    ghostChat: (s) => s.ghostChat,
    autoRelink: (s) => s.autoRelink,
    liveStatus: (s) => s.status.channelId !== null,
    spectatorHandling: (s) => s.nonPlayers !== "ignore",
    nicknameSync: (s) => s.nicknameSync,
    matchSummary: (s) => s.summary.channelId !== null,
};

/** How many of the given servers have each feature switched on. Every telemetry feature key is present. */
export function countFeatureGuilds(settings: readonly GuildSettings[]): Record<TelemetryFeature, number> {
    const counts = Object.fromEntries(TELEMETRY_FEATURES.map((feature) => [feature, 0])) as Record<
        TelemetryFeature,
        number
    >;
    for (const guild of settings) {
        for (const feature of TELEMETRY_FEATURES) {
            if (FEATURE_CHECKS[feature](guild)) counts[feature] += 1;
        }
    }
    return counts;
}
