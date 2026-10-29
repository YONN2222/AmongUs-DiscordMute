import { Registry } from "prom-client";
import { beforeEach, describe, expect, it } from "vitest";
import type { GameSession } from "../../src/Gateway/GameSession";
import { createGatewayMetrics, createGatewayMetricsObserver } from "../../src/Metrics/gatewayMetrics";

function session(sessionId: string, pluginVersion = "3.0.0", gameVersion = "2026.9.29"): GameSession {
    return { sessionId, guildId: `g-${sessionId}`, connectedAt: 0, pluginVersion, gameVersion, protocolVersion: 3 };
}

describe("gateway metrics observer", () => {
    let registry: Registry;
    let observer: ReturnType<typeof createGatewayMetricsObserver>;

    beforeEach(() => {
        registry = new Registry();
        observer = createGatewayMetricsObserver(createGatewayMetrics(registry));
    });

    async function values(name: string) {
        const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name);
        return metric?.values ?? [];
    }

    async function single(name: string, labels: Record<string, string> = {}): Promise<number> {
        const match = (await values(name)).find((v) => Object.entries(labels).every(([k, l]) => v.labels[k] === l));
        return match?.value ?? 0;
    }

    it("game-start with notice does not count as muted", async () => {
        const s = session("a");
        observer.sessionStarted(s);
        observer.gameEventApplied(s, "game-start", { ok: true, notice: { code: "host-not-in-voice", message: "x" } });
        expect(await single("discordmute_games_muted_total")).toBe(0);
        observer.gameEventApplied(s, "game-start", { ok: true });
        expect(await single("discordmute_games_muted_total")).toBe(1);
        observer.gameEventApplied(s, "meeting-start", { ok: true });
        expect(await single("discordmute_games_muted_total")).toBe(1);
    });

    it("counts plugin messages by type", async () => {
        const s = session("a");
        observer.pluginMessage(s, "lobby");
        observer.pluginMessage(s, "link-chat");
        observer.pluginMessage(s, "link-chat");
        observer.pluginMessage(s, "player-died");
        observer.pluginMessage(s, "game-end");
        expect(await single("discordmute_plugin_events_total", { type: "link-chat" })).toBe(2);
        expect(await single("discordmute_plugin_events_total", { type: "player-died" })).toBe(1);
        expect(await single("discordmute_plugin_events_total", { type: "lobby" })).toBe(1);
        expect(await single("discordmute_plugin_events_total", { type: "game-end" })).toBe(1);
    });

    it("active_games drops back on lobby and on session end", async () => {
        const a = session("a");
        const b = session("b");
        observer.sessionStarted(a);
        observer.sessionStarted(b);
        observer.gameEventApplied(a, "game-start", { ok: true });
        observer.gameEventApplied(b, "meeting-start", { ok: true });
        expect(await single("discordmute_active_games")).toBe(2);
        observer.gameEventApplied(a, "lobby", { ok: true });
        expect(await single("discordmute_active_games")).toBe(1);
        observer.sessionEnded(b);
        expect(await single("discordmute_active_games")).toBe(0);
        expect(await single("discordmute_plugins_connected")).toBe(1);
    });

    it("failed events do not start a game", async () => {
        const a = session("a");
        observer.sessionStarted(a);
        observer.gameEventApplied(a, "game-start", { ok: false, error: "timeout" });
        expect(await single("discordmute_active_games")).toBe(0);
    });

    it("junk plugin version is labelled other", async () => {
        observer.sessionStarted(session("a", "<script>junk version with spaces</script>", "2026.9.29"));
        expect(
            await single("discordmute_plugin_sessions", { plugin_version: "other", game_version: "2026.9.29" }),
        ).toBe(1);
    });

    it("16th distinct version folds into other", async () => {
        for (let i = 0; i < 16; i++) observer.sessionStarted(session(`s${i}`, `1.0.${i}`));
        expect(await single("discordmute_plugin_sessions", { plugin_version: "1.0.14" })).toBe(1);
        expect(await single("discordmute_plugin_sessions", { plugin_version: "other" })).toBe(1);
        expect(await single("discordmute_plugin_sessions", { plugin_version: "1.0.15" })).toBe(0);
    });

    it("plugin_sessions goes down on end and stays at 0", async () => {
        const a = session("a");
        observer.sessionStarted(a);
        observer.sessionEnded(a);
        observer.sessionEnded(a);
        const series = await values("discordmute_plugin_sessions");
        expect(series).toHaveLength(1);
        expect(series[0]?.value).toBe(0);
        expect(await single("discordmute_plugins_connected")).toBe(0);
    });

    it("plugins_connected unchanged on takeover", async () => {
        observer.sessionStarted(session("a", "3.0.0"));
        observer.gameEventApplied(session("a"), "game-start", { ok: true });
        observer.sessionStarted(session("a", "3.0.1"));
        expect(await single("discordmute_plugins_connected")).toBe(1);
        expect(await single("discordmute_active_games")).toBe(1);
        expect(await single("discordmute_plugin_sessions", { plugin_version: "3.0.0" })).toBe(0);
        expect(await single("discordmute_plugin_sessions", { plugin_version: "3.0.1" })).toBe(1);
    });
});
