import { Counter, Gauge, type Registry } from "prom-client";
import { MetricNames } from "./metricNames";

export interface GatewayMetrics {
    pluginEvents: Counter<"type">;
    gamesMuted: Counter;
    pluginsConnected: Gauge;
    activeGames: Gauge;
    pluginSessions: Gauge<"plugin_version" | "game_version">;
    clusterSnapshotFailures: Counter;
    processResidentMemory: Gauge<"process">;
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
