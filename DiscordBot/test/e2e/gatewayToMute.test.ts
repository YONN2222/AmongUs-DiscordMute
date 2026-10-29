import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createClusterRequestHandler } from "../../src/Cluster/clusterRequestHandler";
import type { Database } from "../../src/Data/database";
import { createGatewayHttpServer } from "../../src/Gateway/httpServer";
import { PluginGateway } from "../../src/Gateway/PluginGateway";
import { SelfHostSecretResolver } from "../../src/Gateway/SecretResolver";
import { logger } from "../../src/Logging/logger";
import { MuteService, type VoiceAdapter, type VoiceMember } from "../../src/Mute/MuteService";
import { createVoiceTargetResolver } from "../../src/Mute/VoiceTargetResolver";
import { PROTOCOL_VERSION } from "../../src/Protocol/PluginProtocol";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { LinkingService } from "../../src/Utils/LinkingService";
import { createTestDatabase } from "../helpers/testDatabase";

const SECRET = "e2e-secret";
const GUILD = "guild-e2e";
const CHANNEL = "voice-1";

class FakeVoice implements VoiceAdapter {
    readonly inChannel = new Set<string>();
    readonly muted = new Set<string>();

    async membersInChannel(_guildId: string, channelId: string): Promise<VoiceMember[]> {
        return channelId === CHANNEL ? [...this.inChannel].map((id) => this.member(id)) : [];
    }

    async findVoiceMember(_guildId: string, discordId: string): Promise<VoiceMember | null> {
        return this.inChannel.has(discordId) ? this.member(discordId) : null;
    }

    async setServerMute(_guildId: string, discordId: string, mute: boolean): Promise<void> {
        if (mute) this.muted.add(discordId);
        else this.muted.delete(discordId);
    }

    private member(discordId: string): VoiceMember {
        return { discordId, serverMuted: this.muted.has(discordId) };
    }
}

describe("gateway to mute", () => {
    let db: Database;
    let server: Server;
    let gateway: PluginGateway;
    let voice: FakeVoice;
    let baseUrl: string;
    const sockets: WebSocket[] = [];

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        db = await createTestDatabase();
        await db.links.upsert(GUILD, "u-host", "Red");
        await db.links.upsert(GUILD, "u-crew", "Blue");
        voice = new FakeVoice();
        voice.inChannel.add("u-host").add("u-crew");

        const mute = new MuteService({
            voice,
            links: db.links,
            ledger: db.muteLedger,
            resolveTarget: createVoiceTargetResolver({
                links: db.links,
                memberVoiceChannel: async (_guildId, discordId) => (voice.inChannel.has(discordId) ? CHANNEL : null),
                fallbackChannelIds: [],
                localeOf: async () => "en",
            }),
        });
        const router = new InMemoryClusterRouter();
        router.register(
            GUILD,
            createClusterRequestHandler({ mute, updateLinkReply: async () => true, isReady: () => true }),
        );

        gateway = new PluginGateway({
            resolver: new SelfHostSecretResolver({ secret: SECRET, guildId: GUILD }),
            router,
            linking: new LinkingService(db),
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

    async function connectPlugin(): Promise<WebSocket> {
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

    it("answers /health without the secret and 404 elsewhere", async () => {
        const health = await fetch(`http://${baseUrl}/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ status: "ok" });

        const other = await fetch(`http://${baseUrl}/ping`);
        expect(other.status).toBe(404);
    });
});
