import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createClusterRequestHandler } from "../../src/Cluster/ClusterRequestHandler";
import type { Database } from "../../src/Data/Database";
import { type GuildEvent, GuildEventBus } from "../../src/Events/GuildEvents";
import { createGatewayHttpServer } from "../../src/Gateway/HttpServer";
import { PluginGateway } from "../../src/Gateway/PluginGateway";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { LinkingService } from "../../src/Linking/LinkingService";
import { logger } from "../../src/Logging/Logger";
import { MuteService, type VoiceAdapter, type VoiceMember } from "../../src/Mute/MuteService";
import { createVoiceTargetResolver } from "../../src/Mute/VoiceTargetResolver";
import { PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { createTestDatabase } from "../Helpers/TestDatabase";

const SECRET = "e2e-secret";
const GUILD = "guild-e2e";
const CHANNEL = "voice-1";
const ROUTE_TIMEOUT_MS = 300;

interface Gate {
    promise: Promise<void>;
    open: () => void;
}

function createGate(): Gate {
    let open = (): void => {};
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

class FakeVoice implements VoiceAdapter {
    readonly channelOf = new Map<string, string>();
    readonly muted = new Set<string>();

    async membersInChannel(_guildId: string, channelId: string): Promise<VoiceMember[]> {
        return [...this.channelOf]
            .filter(([, channel]) => channel === channelId)
            .map(([discordId]) => this.member(discordId));
    }

    async findVoiceMember(_guildId: string, discordId: string): Promise<VoiceMember | null> {
        return this.channelOf.has(discordId) ? this.member(discordId) : null;
    }

    async setVoiceState(_guildId: string, discordId: string, patch: { mute?: boolean }): Promise<void> {
        if (patch.mute === true) this.muted.add(discordId);
        if (patch.mute === false) this.muted.delete(discordId);
    }

    private member(discordId: string): VoiceMember {
        return { discordId, serverMuted: this.muted.has(discordId), serverDeafened: false, isBot: false };
    }
}

describe("gateway to mute", () => {
    let db: Database;
    let server: Server;
    let gateway: PluginGateway;
    let voice: FakeVoice;
    let baseUrl: string;
    let events: GuildEvent[];
    let router: InMemoryClusterRouter;
    /** While set, the cluster handler waits in its settings lookup, which holds a game event in relinking. */
    let handlerSettingsGate: Gate | undefined;
    /** The cluster answers this many session-ended requests with an error before it handles one. */
    let failedSessionEnds: number;
    const sockets: WebSocket[] = [];

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        db = await createTestDatabase();
        await db.links.upsert(GUILD, "u-host", "Red");
        await db.links.upsert(GUILD, "u-crew", "Blue");
        voice = new FakeVoice();
        voice.channelOf.set("u-host", CHANNEL).set("u-crew", CHANNEL);
        events = [];
        handlerSettingsGate = undefined;
        failedSessionEnds = 0;
        const bus = new GuildEventBus();
        bus.on((e) => {
            events.push(e);
        });

        const mute = new MuteService({
            events: bus,
            voice,
            settings: { get: async () => DEFAULT_SETTINGS },
            links: db.links,
            ledger: db.muteLedger,
            resolveTarget: createVoiceTargetResolver({
                links: db.links,
                memberVoiceChannel: async (_guildId, discordId) => voice.channelOf.get(discordId) ?? null,
                fallbackChannelIds: async () => [],
                localeOf: async () => "en",
            }),
        });
        const handle = createClusterRequestHandler({
            mute,
            updateLinkReply: async () => true,
            isReady: () => true,
            events: bus,
            links: db.links,
            settings: {
                get: async () => {
                    await handlerSettingsGate?.promise;
                    return DEFAULT_SETTINGS;
                },
            },
        });
        router = new InMemoryClusterRouter();
        router.register(GUILD, async (req) => {
            if (req.kind === "session-ended" && failedSessionEnds > 0) {
                failedSessionEnds--;
                return { ok: false, error: "timeout" };
            }
            return handle(req);
        });

        gateway = new PluginGateway({
            resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }),
            router,
            linking: new LinkingService(db),
            routeTimeoutMs: ROUTE_TIMEOUT_MS,
            sessionEndRetryDelaysMs: [20, 20, 20],
        });
        server = createGatewayHttpServer();
        gateway.attach(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        baseUrl = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        for (const ws of sockets.splice(0)) ws.terminate();
        await gateway.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.close();
        vi.restoreAllMocks();
    });

    async function connectPlugin(connectionKey?: string): Promise<WebSocket> {
        const ws = new WebSocket(`ws://${baseUrl}/ws`);
        sockets.push(ws);
        await new Promise((resolve, reject) => {
            ws.once("open", resolve);
            ws.once("error", reject);
        });
        const welcome = new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));
        ws.send(
            JSON.stringify({
                type: "hello",
                protocolVersion: PROTOCOL_VERSION,
                secret: SECRET,
                pluginVersion: "2.0.0",
                gameVersion: "2026.9.1",
                ...(connectionKey ? { connectionKey } : {}),
            }),
        );
        expect(await welcome).toMatchObject({ type: "welcome" });
        return ws;
    }

    it("mutes linked members on game-start and unmutes them when the plugin disconnects", async () => {
        const ws = await connectPlugin();
        ws.send(
            JSON.stringify({
                type: "game-event",
                event: "game-start",
                hostAccountName: "Red",
                players: ["Red", "Blue"],
                deadPlayers: [],
            }),
        );
        await vi.waitFor(() => expect([...voice.muted].sort()).toEqual(["u-crew", "u-host"]));

        ws.close();
        await vi.waitFor(() => expect(voice.muted.size).toBe(0));
        expect(await db.muteLedger.listByGuild(GUILD)).toEqual([]);
    });

    it("keeps the alive player muted when a player dies during tasks", async () => {
        const ws = await connectPlugin();
        const send = (event: string, deadPlayers: string[]) =>
            ws.send(
                JSON.stringify({
                    type: "game-event",
                    event,
                    hostAccountName: "Red",
                    players: ["Red", "Blue"],
                    deadPlayers,
                }),
            );
        send("game-start", []);
        send("player-died", ["Blue"]);

        await vi.waitFor(() =>
            expect(events).toContainEqual(
                expect.objectContaining({ type: "game-event", event: "player-died", channelIds: [CHANNEL] }),
            ),
        );
        expect([...voice.muted].sort()).toEqual(["u-crew", "u-host"]);
        expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it("two plugins in one guild mute their own channels", async () => {
        await db.links.upsert(GUILD, "u-host2", "Green");
        await db.links.upsert(GUILD, "u-crew2", "Yellow");
        voice.channelOf.set("u-host2", "voice-2").set("u-crew2", "voice-2");
        const startGame = (ws: WebSocket, host: string, crew: string) =>
            ws.send(
                JSON.stringify({
                    type: "game-event",
                    event: "game-start",
                    hostAccountName: host,
                    players: [host, crew],
                    deadPlayers: [],
                }),
            );
        const first = await connectPlugin("a".repeat(32));
        const second = await connectPlugin("b".repeat(32));

        startGame(first, "Red", "Blue");
        await vi.waitFor(() => expect([...voice.muted].sort()).toEqual(["u-crew", "u-host"]));
        startGame(second, "Green", "Yellow");
        await vi.waitFor(() => expect(voice.muted.size).toBe(4));

        first.close();
        await vi.waitFor(() => expect([...voice.muted].sort()).toEqual(["u-crew2", "u-host2"]));
        expect(second.readyState).toBe(WebSocket.OPEN);

        second.close();
        await vi.waitFor(() => expect(voice.muted.size).toBe(0));
        expect(await db.muteLedger.listByGuild(GUILD)).toEqual([]);
    });

    it("drops a game event that reaches the cluster after its session ended and leaves nobody muted", async () => {
        const ws = await connectPlugin();
        handlerSettingsGate = createGate();
        ws.send(
            JSON.stringify({
                type: "game-event",
                event: "game-start",
                hostAccountName: "Red",
                players: ["Red", "Blue"],
                deadPlayers: [],
                roster: [
                    { name: "Red", dead: false, disconnected: false },
                    { name: "Blue", dead: false, disconnected: false },
                ],
            }),
        );
        await vi.waitFor(() => expect(router.sent.some((s) => s.req.kind === "game-event")).toBe(true));

        ws.close();
        await vi.waitFor(() => expect(events.some((e) => e.type === "session-ended")).toBe(true), { timeout: 3000 });
        handlerSettingsGate.open();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(voice.muted.size).toBe(0);
        expect(await db.muteLedger.listByGuild(GUILD)).toEqual([]);
        expect(events.some((e) => e.type === "game-event")).toBe(false);
    });

    it("retries a failed session-ended until the cluster handles it and lifts the mutes", async () => {
        const ws = await connectPlugin();
        ws.send(
            JSON.stringify({
                type: "game-event",
                event: "game-start",
                hostAccountName: "Red",
                players: ["Red", "Blue"],
                deadPlayers: [],
            }),
        );
        await vi.waitFor(() => expect(voice.muted.size).toBe(2));
        failedSessionEnds = 2;

        ws.close();

        await vi.waitFor(() => expect(voice.muted.size).toBe(0));
        expect(router.sent.filter((s) => s.req.kind === "session-ended")).toHaveLength(3);
        expect(await db.muteLedger.listByGuild(GUILD)).toEqual([]);
    });

    it("answers /health without the secret and 404 elsewhere", async () => {
        const health = await fetch(`http://${baseUrl}/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ status: "ok" });

        const other = await fetch(`http://${baseUrl}/ping`);
        expect(other.status).toBe(404);
    });
});
