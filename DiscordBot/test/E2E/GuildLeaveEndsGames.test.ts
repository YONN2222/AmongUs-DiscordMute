import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AdminHandlers, createAdminHandlers } from "../../src/Admin/AdminHandlers";
import { createClusterRequestHandler } from "../../src/Cluster/ClusterRequestHandler";
import type { Database } from "../../src/Data/Database";
import { LEFT_GUILD_RETENTION_MS } from "../../src/Data/Repositories/HostedGuildRepository";
import { GuildEventBus } from "../../src/Events/GuildEvents";
import { type NicknameAdapter, NicknameSync } from "../../src/Game/NicknameSync";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { type GuildInfo, GuildLifecycle, type GuildPort } from "../../src/Hosted/GuildLifecycle";
import { purgeLeftGuilds } from "../../src/Hosted/LeftGuildPurge";
import { logger } from "../../src/Logging/Logger";
import { MuteService, type VoiceAdapter, type VoiceMember } from "../../src/Mute/MuteService";
import { InMemoryClusterRouter } from "../../src/Routing/ClusterRouter";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { clusterQueryStubs } from "../Helpers/ClusterQueryStubs";
import { unknownProfiles } from "../Helpers/ProfileLookupStub";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

const CHANNEL = "voice-1";
const SESSION = "session-1";
const ORIGINAL_NICKS: Record<string, string> = { "u-host": "Hosty", "u-crew": "Crewy" };

/** One Discord guild: who sits in voice, who is server-muted and which nickname each member has. */
class FakeDiscord implements VoiceAdapter, NicknameAdapter {
    readonly muted = new Set<string>();
    readonly nicks = new Map<string, string | null>(Object.entries(ORIGINAL_NICKS));
    /** Every call the bot made to Discord. */
    calls = 0;

    async membersInChannel(): Promise<VoiceMember[]> {
        this.calls += 1;
        return [...this.nicks.keys()].map((discordId) => this.member(discordId));
    }

    async findVoiceMember(_guildId: string, discordId: string): Promise<VoiceMember | null> {
        this.calls += 1;
        return this.nicks.has(discordId) ? this.member(discordId) : null;
    }

    async setVoiceState(_guildId: string, discordId: string, patch: { mute?: boolean }): Promise<void> {
        this.calls += 1;
        if (patch.mute === true) this.muted.add(discordId);
        if (patch.mute === false) this.muted.delete(discordId);
    }

    async nicknameOf(_guildId: string, discordId: string) {
        this.calls += 1;
        return this.nicks.has(discordId) ? { nick: this.nicks.get(discordId) ?? null } : null;
    }

    async setNickname(_guildId: string, discordId: string, nick: string | null): Promise<void> {
        this.calls += 1;
        this.nicks.set(discordId, nick);
    }

    async voiceChannelOf(): Promise<string> {
        this.calls += 1;
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
        let clock: number;
        /** Runs between ending the games and the leave itself, where Discord takes its time. */
        let duringLeave: () => Promise<void>;

        const info = (): GuildInfo => ({ guildId, name: "Crew", icon: null, ownerId, memberCount: 5 });

        /** Leaves like Discord does: the leave is followed by a guild delete event, which purges the guild data. */
        function discordPort(): GuildPort {
            return {
                leave: async (id) => {
                    await duringLeave();
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

        function gameEvent(event: "game-start" | "meeting-end", sessionId = SESSION) {
            return {
                kind: "game-event" as const,
                guildId,
                sessionId,
                hostAccountName: "Red",
                event,
                players: ["Red", "Blue"],
                deadPlayers: [],
            };
        }

        async function startGame(sessionId = SESSION): Promise<void> {
            expect(await router.send(guildId, gameEvent("game-start", sessionId))).toMatchObject({ ok: true });
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
            clock = 10_000;
            duringLeave = async () => {};
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
                games: {
                    end: async (id) => {
                        await mute.endGuild(id);
                        await nicknames.endGuild(id);
                    },
                    reopen: (id) => {
                        mute.reopenGuild(id);
                        nicknames.reopenGuild(id);
                    },
                    forget: (id) => {
                        mute.forgetGuild(id);
                        nicknames.forgetGuild(id);
                    },
                    recover: async (id) => {
                        await mute.recover([id]);
                        await nicknames.recover([id]);
                    },
                },
                disconnectBlocked: async () => {},
                disconnectRemoved: async () => {},
                now: () => clock,
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
                    ...clusterQueryStubs,
                }),
            );
            admin = createAdminHandlers({
                db,
                // The plugin disconnect only starts the session end, so its session-ended arrives after the leave.
                plugins: {
                    sessionCount: () => 1,
                    sessionsOfGuild: () => 1,
                    sessionsInfo: () => [],
                    disconnectGuild: () => 1,
                },
                activeGames: async () => 1,
                clusterInfo: async () => [],
                profiles: unknownProfiles,
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

        it("a game start that arrives while the bot leaves after an auto leave is dropped", async () => {
            await startGame();
            await db.blocks.create({ type: "user", targetId: ownerId, reason: "spam", blockedBy: operatorId });
            duringLeave = async () => {
                await router.send(guildId, gameEvent("game-start", "session-2"));
            };

            await lifecycle.onGuildUpdate(info());

            expectNobodyMutedOrRenamed();
        });

        describe("when the guild removes the bot during a game", () => {
            async function kickDuringGame(): Promise<void> {
                await startGame();
                discord.calls = 0;
                await lifecycle.onGuildDelete(guildId);
                await router.send(guildId, gameEvent("meeting-end"));
                await router.send(guildId, { kind: "session-ended", guildId, sessionId: SESSION });
            }

            it("makes no Discord calls and keeps the ledger rows", async () => {
                await kickDuringGame();

                expect(discord.calls).toBe(0);
                expect(await db.muteLedger.listByGuild(guildId)).toHaveLength(2);
                expect(await db.nicknameLedger.listByGuild(guildId)).toHaveLength(2);
                expect((await db.hostedGuilds.get(guildId))?.leftAt).toBe(clock);
            });

            it("adding the bot back lifts every leftover mute and nickname, then games work again", async () => {
                await kickDuringGame();

                await lifecycle.onGuildCreate(info());

                expect(discord.muted.size).toBe(0);
                expect(Object.fromEntries(discord.nicks)).toEqual(ORIGINAL_NICKS);
                expect(await db.muteLedger.listByGuild(guildId)).toEqual([]);
                expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
                await startGame("session-2");
            });

            it("the purge seven days later removes the ledger rows", async () => {
                await kickDuringGame();

                await purgeLeftGuilds(db, clock + LEFT_GUILD_RETENTION_MS);

                expect(await db.muteLedger.listByGuild(guildId)).toEqual([]);
                expect(await db.nicknameLedger.listByGuild(guildId)).toEqual([]);
                expect(await db.hostedGuilds.get(guildId)).toBeNull();
            });
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
