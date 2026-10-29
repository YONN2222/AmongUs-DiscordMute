import { Counter, Gauge, type Registry } from "prom-client";
import type { GameSession } from "../Gateway/GameSession";
import type { GatewayObserver } from "../Gateway/PluginGateway";
import { BoundedLabelSet, MAX_VERSION_LABELS, sanitizeVersionLabel } from "./Labels";
import { MetricNames } from "./MetricNames";

export interface GatewayMetrics {
    pluginEvents: Counter<"type">;
    gamesMuted: Counter;
    pluginsConnected: Gauge;
    activeGames: Gauge;
    pluginSessions: Gauge<"plugin_version" | "game_version">;
    clusterSnapshotFailures: Counter;
    processResidentMemory: Gauge<"process">;
}

interface TrackedSession {
    versionKey: string;
    active: boolean;
}

export function createGatewayMetricsObserver(metrics: GatewayMetrics): GatewayObserver {
    const sessions = new Map<string, TrackedSession>();
    const pluginVersions = new BoundedLabelSet(MAX_VERSION_LABELS);
    const gameVersions = new BoundedLabelSet(MAX_VERSION_LABELS);
    const knownLabels = new Map<string, { plugin_version: string; game_version: string }>();

    const labelsFor = (session: GameSession) => ({
        plugin_version: pluginVersions.admit(sanitizeVersionLabel(session.pluginVersion)),
        game_version: gameVersions.admit(sanitizeVersionLabel(session.gameVersion)),
    });

    const refresh = (): void => {
        const counts = new Map<string, number>();
        let active = 0;
        for (const tracked of sessions.values()) {
            counts.set(tracked.versionKey, (counts.get(tracked.versionKey) ?? 0) + 1);
            if (tracked.active) active++;
        }
        metrics.pluginsConnected.set(sessions.size);
        metrics.activeGames.set(active);
        metrics.pluginSessions.reset();
        for (const [key, labels] of knownLabels) metrics.pluginSessions.set(labels, counts.get(key) ?? 0);
    };

    return {
        sessionStarted(session) {
            const labels = labelsFor(session);
            const versionKey = `${labels.plugin_version}\n${labels.game_version}`;
            knownLabels.set(versionKey, labels);
            sessions.set(session.sessionId, {
                versionKey,
                active: sessions.get(session.sessionId)?.active ?? false,
            });
            refresh();
        },
        sessionEnded(session) {
            sessions.delete(session.sessionId);
            refresh();
        },
        pluginMessage(_session, type) {
            metrics.pluginEvents.inc({ type });
        },
        gameEventApplied(session, event, reply) {
            if (!reply.ok) return;
            if (event === "game-start" && !reply.notice) metrics.gamesMuted.inc();
            const tracked = sessions.get(session.sessionId);
            if (!tracked) return;
            tracked.active = event !== "lobby";
            refresh();
        },
    };
}

export function createGatewayMetrics(registry: Registry): GatewayMetrics {
    const registers = [registry];
    return {
        pluginEvents: new Counter<"type">({
            name: MetricNames.pluginEvents,
            help: "Events received from game plugins by type",
            labelNames: ["type"] satisfies ["type"],
            registers,
        }),
        gamesMuted: new Counter({
            name: MetricNames.gamesMuted,
            help: "Games for which muting was started",
            registers,
        }),
        pluginsConnected: new Gauge({
            name: MetricNames.pluginsConnected,
            help: "Currently connected plugins",
            registers,
        }),
        activeGames: new Gauge({
            name: MetricNames.activeGames,
            help: "Games currently in progress",
            registers,
        }),
        pluginSessions: new Gauge<"plugin_version" | "game_version">({
            name: MetricNames.pluginSessions,
            help: "Connected plugin sessions per plugin and game version",
            labelNames: ["plugin_version", "game_version"],
            registers,
        }),
        clusterSnapshotFailures: new Counter({
            name: MetricNames.clusterSnapshotFailures,
            help: "Failed cluster snapshot requests",
            registers,
        }),
        processResidentMemory: new Gauge<"process">({
            name: MetricNames.processResidentMemory,
            help: "Resident set size of the process in bytes",
            labelNames: ["process"],
            registers,
            collect() {
                this.set({ process: "gateway" }, process.memoryUsage().rss);
            },
        }),
    };
}
