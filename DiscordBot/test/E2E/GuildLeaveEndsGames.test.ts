import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AdminHandlers, createAdminHandlers } from "../../src/Admin/AdminHandlers";
import { createClusterRequestHandler } from "../../src/Cluster/ClusterRequestHandler";
import type { Database } from "../../src/Data/Database";
import { GuildEventBus } from "../../src/Events/GuildEvents";
import { type NicknameAdapter, NicknameSync } from "../../src/Game/NicknameSync";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { type GuildInfo, GuildLifecycle, type GuildPort } from "../../src/Hosted/GuildLifecycle";
import { logger } from "../../src/Logging/Logger";
import { MuteService, type VoiceAdapter, type VoiceMember } from "../../src/Mute/MuteService";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const CHANNEL = "voice-1";
const SESSION = "session-1";
const ORIGINAL_NICKS: Record<string, string> = { "u-host": "Hosty", "u-crew": "Crewy" };

/** One Discord guild: who sits in voice, who is server-muted and which nickname each member has. */
class FakeDiscord implements VoiceAdapter, NicknameAdapter {
    readonly muted = new Set<string>();
    readonly nicks = new Map<string, string | null>(Object.entries(ORIGINAL_NICKS));

    async membersInChannel(): Promise<VoiceMember[]> {
        return [...this.nicks.keys()].map((discordId) => this.member(discordId));
    }

    async findVoiceMember(_guildId: string, discordId: string): Promise<VoiceMember | null> {
        return this.nicks.has(discordId) ? this.member(discordId) : null;
    }

    async setVoiceState(_guildId: string, discordId: string, patch: { mute?: boolean }): Promise<void> {
        if (patch.mute === true) this.muted.add(discordId);
        if (patch.mute === false) this.muted.delete(discordId);
    }

    async nicknameOf(_guildId: string, discordId: string) {
        return this.nicks.has(discordId) ? { nick: this.nicks.get(discordId) ?? null } : null;
    }

    async setNickname(_guildId: string, discordId: string, nick: string | null): Promise<void> {
        this.nicks.set(discordId, nick);
    }

    async voiceChannelOf(): Promise<string> {
        return CHANNEL;
    }

    private member(discordId: string): VoiceMember {
        return { discordId, serverMuted: this.muted.has(discordId), serverDeafened: false, isBot: false };
    }
}

/** What the members looked like at the moment the bot left the guild. */
interface LeaveSnapshot {
    muted: string[];
    nicks: Record<string, string | null>;
}

describe.each(backends)("leaving a guild during a game (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let discord: FakeDiscord;
        let router: InMemoryClusterRouter;
        let lifecycle: GuildLifecycle;
        let admin: AdminHandlers;
        let guildId: string;
        let ownerId: string;
        let operatorId: string;
        let atLeave: LeaveSnapshot | null;

        const info = (): GuildInfo => ({ guildId, name: "Crew", icon: null, ownerId, memberCount: 5 });

        /** Leaves like Discord does: the leave is followed by a guild delete event, which purges the guild data. */
        function discordPort(): GuildPort {
            return {
                leave: async (id) => {
                    atLeave = { muted: [...discord.muted].sort(), nicks: Object.fromEntries(discord.nicks) };
                    await lifecycle.onGuildDelete(id);
                    return true;
                },
                cachedGuilds: () => [],
                cachedGuildIds: () => [],
                ownsGuild: () => true,
                fetchMemberGuildIds: async () => new Set(),
            };
        }

        function gameEvent(event: "game-start" | "meeting-end") {
            return {
                kind: "game-event" as const,
                guildId,
                sessionId: SESSION,
                hostAccountName: "Red",
                event,
                players: ["Red", "Blue"],
                deadPlayers: [],
            };
        }

        async function startGame(): Promise<void> {
            expect(await router.send(guildId, gameEvent("game-start"))).toMatchObject({ ok: true });
            await vi.waitFor(() => expect(discord.nicks.get("u-crew")).toBe("Blue"));
            expect([...discord.muted].sort()).toEqual(["u-crew", "u-host"]);
        }

        function expectNobodyMutedOrRenamed(): void {
            expect(atLeave).toEqual({ muted: [], nicks: ORIGINAL_NICKS });
            expect(discord.muted.size).toBe(0);
        }

        beforeEach(async () => {
            for (const level of ["info", "warn", "error", "debug", "success"] as const) {
                vi.spyOn(logger, level).mockImplementation(() => {});
            }
            db = await openBackend(backend);
            guildId = uniqueId("guild");
            ownerId = uniqueId("owner");
            operatorId = uniqueId("operator");
            atLeave = null;
            discord = new FakeDiscord();
            await db.links.upsert(guildId, "u-host", "Red");
            await db.links.upsert(guildId, "u-crew", "Blue");
            await db.hostedGuilds.upsert({ ...info(), joinedAt: 1000 }, 1000);

            const settings = { get: async () => ({ ...DEFAULT_SETTINGS, nicknameSync: true }) };
            const events = new GuildEventBus();
            const nicknames = new NicknameSync({
                adapter: discord,
                ledger: db.nicknameLedger,
                links: db.links,
                settings,
                events,
            });
            events.on((event) => nicknames.handle(event));
            const mute = new MuteService({
                voice: discord,
                links: db.links,
                ledger: db.muteLedger,
                resolveTarget: async () => ({ channelIds: [CHANNEL] }),
                settings,
            });
            const blocks = new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds });
            lifecycle = new GuildLifecycle({
                port: discordPort(),
                hostedGuilds: db.hostedGuilds,
                blocks,
                audit: db.audit,
                endGames: async (id) => {
                    await mute.endGuild(id);
                    await nicknames.endGuild(id);
                },
            });
            router = new InMemoryClusterRouter();
            router.register(
                guildId,
                createClusterRequestHandler({
                    mute,
                    updateLinkReply: async () => true,
                    isReady: () => true,
                    events,
                    links: db.links,
                    settings,
                    nicknames,
                    lifecycle,
                }),
            );
            admin = createAdminHandlers({
                db,
                // The plugin disconnect only starts the session end, so its session-ended arrives after the leave.
                plugins: { sessionCount: () => 1, sessionsOfGuild: () => 1, disconnectGuild: () => 1 },
                activeGames: async () => 1,
                clusterInfo: async () => [],
                router,
                version: "3.0.0",
                startedAt: 0,
            });
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
            vi.restoreAllMocks();
        });

        it("an admin block unmutes everyone and restores nicknames before the bot leaves", async () => {
            await startGame();

            await admin.createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: operatorId });

            expectNobodyMutedOrRenamed();
            expect(await db.muteLedger.listByGuild(guildId)).toEqual([]);
            expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
        });

        it("an admin leave unmutes everyone and restores nicknames before the bot leaves", async () => {
            await startGame();

            expect(await admin.leaveGuild(guildId, { actorId: operatorId, reason: "test" })).toEqual({ left: true });

            expectNobodyMutedOrRenamed();
        });

        it("an auto leave for a blocked owner unmutes everyone and restores nicknames first", async () => {
            await startGame();
            await db.blocks.create({ type: "user", targetId: ownerId, reason: "spam", blockedBy: operatorId });

            await lifecycle.onGuildUpdate(info());

            expectNobodyMutedOrRenamed();
        });

        it("nobody is muted again when the game's last events and the plugin disconnect arrive after the leave", async () => {
            await startGame();
            await admin.createBlock({ type: "guild", targetId: guildId, reason: "spam", actorId: operatorId });

            await router.send(guildId, gameEvent("meeting-end"));
            await router.send(guildId, { kind: "session-ended", guildId, sessionId: SESSION });

            expectNobodyMutedOrRenamed();
            expect(Object.fromEntries(discord.nicks)).toEqual(ORIGINAL_NICKS);
        });
    });
});
