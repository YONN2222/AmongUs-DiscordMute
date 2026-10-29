export const METRIC_PREFIX = "discordmute_";

export const MetricNames = {
    pluginEvents: `${METRIC_PREFIX}plugin_events_total`,
    gamesMuted: `${METRIC_PREFIX}games_muted_total`,
    pluginsConnected: `${METRIC_PREFIX}plugins_connected`,
    activeGames: `${METRIC_PREFIX}active_games`,
    pluginSessions: `${METRIC_PREFIX}plugin_sessions`,
    clusterSnapshotFailures: `${METRIC_PREFIX}cluster_snapshot_failures_total`,
    processResidentMemory: `${METRIC_PREFIX}process_resident_memory_bytes`,
    mutes: `${METRIC_PREFIX}mutes_total`,
    muteFailures: `${METRIC_PREFIX}mute_failures_total`,
    muteLatency: `${METRIC_PREFIX}mute_latency_seconds`,
    rateLimitHits: `${METRIC_PREFIX}rate_limit_hits_total`,
    guilds: `${METRIC_PREFIX}guilds`,
    clusterGuilds: `${METRIC_PREFIX}cluster_guilds`,
    clusterWsPing: `${METRIC_PREFIX}cluster_ws_ping_seconds`,
    featureGuilds: `${METRIC_PREFIX}feature_guilds`,
} as const;

export const PLUGIN_EVENT_TYPES = [
    "lobby",
    "game-start",
    "meeting-start",
    "meeting-end",
    "player-died",
    "game-end",
    "link-chat",
] as const;
export type PluginEventType = (typeof PLUGIN_EVENT_TYPES)[number];

export type MuteAction = "mute" | "unmute";

export const MUTE_LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
