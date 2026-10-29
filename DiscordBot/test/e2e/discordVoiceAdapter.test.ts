import { ChannelType, GatewayDispatchEvents, GatewayOpcodes } from "discord.js";
import { buildGuildCreateDispatch, buildUser, DEFAULT_IDS, restError } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscordClient } from "../../src/Cluster/createDiscordClient";
import { DiscordVoiceAdapter } from "../../src/Cluster/DiscordVoiceAdapter";
import { registerVoiceRejoin } from "../../src/Cluster/voiceRejoin";
import type { Database } from "../../src/Data/database";
import { logger } from "../../src/Logging/logger";
import { MuteService } from "../../src/Mute/MuteService";
import { createTestProbe } from "../helpers/probe";
import { createTestDatabase } from "../helpers/testDatabase";

const GUILD = DEFAULT_IDS.guild;
const VOICE = "1200000000000000001";
const OTHER_VOICE = "1200000000000000002";
const HOST = "1300000000000000001";
const CREW = "1300000000000000002";
const OUTSIDE = "1300000000000000003";
const MEMBER_ROUTE = /\/guilds\/(\d+)\/members\/(\d+)$/;

function member(id: string) {
    return {
        user: buildUser({ id, username: `user-${id.slice(-1)}` }),
        roles: [],
        joined_at: "2024-01-01T00:00:00.000Z",
        deaf: false,
        mute: false,
        flags: 0,
    };
}

function voiceState(userId: string, channelId: string | null, mute = false) {
    return {
        guild_id: GUILD,
        channel_id: channelId,
        user_id: userId,
        session_id: `session-${userId}`,
        deaf: false,
        mute,
        self_deaf: false,
        self_mute: false,
        self_video: false,
        suppress: false,
        request_to_speak_timestamp: null,
    };
}

function voiceChannel(id: string) {
    return { id, type: ChannelType.GuildVoice, name: `voice-${id.slice(-1)}`, position: 1, permission_overwrites: [] };
}

/** The GUILD_CREATE builder knows no voice data, so voice channels and states are added to its payload. */
function guildWithVoice() {
    const dispatch = buildGuildCreateDispatch({ members: [member(HOST), member(CREW), member(OUTSIDE)] });
    return {
        ...dispatch,
        d: {
            ...dispatch.d,
            channels: [...dispatch.d.channels, voiceChannel(VOICE), voiceChannel(OTHER_VOICE)],
            voice_states: [voiceState(HOST, VOICE), voiceState(CREW, VOICE, true), voiceState(OUTSIDE, OTHER_VOICE)],
        },
    } as typeof dispatch;
}

function gameStart(players: string[]) {
    return {
        kind: "game-event" as const,
        guildId: GUILD,
        sessionId: "s1",
        hostAccountName: "Red",
        event: "game-start" as const,
        players,
        deadPlayers: [],
    };
}

describe("DiscordVoiceAdapter", () => {
    let db: Database;
    let probe: ReturnType<typeof createTestProbe>;
    let adapter: DiscordVoiceAdapter;
    let mute: MuteService;

    function memberPatches() {
        return probe.capturedRequests().filter((r) => r.method === "PATCH" && MEMBER_ROUTE.test(r.url));
    }

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        db = await createTestDatabase();
        await db.links.upsert(GUILD, HOST, "Red");
        await db.links.upsert(GUILD, CREW, "Blue");
        const client = createDiscordClient();
        probe = createTestProbe(client);
        adapter = new DiscordVoiceAdapter(client);
        mute = new MuteService({
            voice: adapter,
            links: db.links,
            ledger: db.muteLedger,
            resolveTarget: async () => ({ channelIds: [VOICE] }),
        });
        registerVoiceRejoin(client, mute);
        probe.respond("PATCH", MEMBER_ROUTE, ({ match }) => member(match[2]));
        await probe.setup();
        probe.injectDispatch(guildWithVoice());
    });

    afterEach(async () => {
        await probe.teardown();
        await db.close();
        vi.restoreAllMocks();
    });

    it("lists the members of a voice channel with their server mute", async () => {
        expect(await adapter.membersInChannel(GUILD, VOICE)).toEqual([
            { discordId: HOST, serverMuted: false },
            { discordId: CREW, serverMuted: true },
        ]);
    });

    it("finds members in any voice channel and nobody outside voice", async () => {
        expect(await adapter.findVoiceMember(GUILD, OUTSIDE)).toEqual({ discordId: OUTSIDE, serverMuted: false });
        expect(await adapter.findVoiceMember(GUILD, "1300000000000000099")).toBeNull();
        expect(await adapter.voiceChannelOf(GUILD, HOST)).toBe(VOICE);
    });

    it("server-mutes through PATCH /guilds/{id}/members/{id}", async () => {
        expect(await mute.handleGameEvent(gameStart(["Red", "Blue"]))).toEqual({ ok: true, channelIds: [VOICE] });

        expect(memberPatches()).toHaveLength(1);
        expect(memberPatches()[0].url).toContain(`/guilds/${GUILD}/members/${HOST}`);
        expect(memberPatches()[0].body).toEqual({ mute: true });
    });

    it("logs a 403 from Discord instead of throwing", async () => {
        probe.respond("PATCH", MEMBER_ROUTE, () => restError(403, { code: 50013, message: "Missing Permissions" }));

        expect(await mute.handleGameEvent(gameStart(["Red"]))).toEqual({ ok: true, channelIds: [VOICE] });

        expect(memberPatches()[0].status).toBe(403);
        expect(logger.error).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining(HOST),
            expect.objectContaining({ status: 403 }),
        );
        expect(await db.muteLedger.listByGuild(GUILD)).toEqual([]);
    });

    it("unmutes a ledger member who joins voice while no game runs", async () => {
        await db.muteLedger.add(GUILD, CREW);
        probe.injectDispatch({
            op: GatewayOpcodes.Dispatch,
            s: 2,
            t: GatewayDispatchEvents.VoiceStateUpdate,
            d: voiceState(CREW, OTHER_VOICE, true),
        });

        await vi.waitFor(() => expect(memberPatches()).toHaveLength(1));
        expect(memberPatches()[0].body).toEqual({ mute: false });
        await vi.waitFor(async () => expect(await db.muteLedger.listByGuild(GUILD)).toEqual([]));
    });
});
