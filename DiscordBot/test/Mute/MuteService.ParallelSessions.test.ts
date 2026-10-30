import { beforeEach, describe, expect, it, vi } from "vitest";
import { MuteService } from "../../src/Mute/MuteService";
import type { GameEventName } from "../../src/Protocol/PluginProtocol";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { type GameEventRequest, GUILD, gameEvent, useMuteServiceFixture } from "../Helpers/MuteServiceFixture";

describe("MuteService", () => {
    const fx = useMuteServiceFixture();

    describe("parallel sessions", () => {
        /** Game A is hosted by Red in c1, game B by Green in c2. */
        const HOSTS: Record<string, { host: string; channelId: string }> = {
            A: { host: "Red", channelId: "c1" },
            B: { host: "Green", channelId: "c2" },
        };

        function eventOf(sessionId: "A" | "B", event: GameEventName, players: string[]): GameEventRequest {
            return { ...gameEvent(event, players), sessionId, hostAccountName: HOSTS[sessionId].host };
        }

        function createParallelService(): MuteService {
            return new MuteService({
                voice: fx.voice,
                links: fx.db.links,
                ledger: fx.db.muteLedger,
                resolveTarget: async (_guildId, host) => ({
                    channelIds: [host === "Red" ? HOSTS.A.channelId : HOSTS.B.channelId],
                }),
                settings: { get: async () => fx.settings },
                sleep: (ms) => fx.sleep(ms),
            });
        }

        async function startBoth(service: MuteService): Promise<void> {
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            await service.handleGameEvent(eventOf("B", "game-start", ["Green", "Yellow"]));
        }

        beforeEach(async () => {
            await fx.db.links.upsert(GUILD, "u4", "Yellow");
            fx.voice.channels.set("c1", ["u1", "u2"]);
            fx.voice.channels.set("c2", ["u3", "u4"]);
        });

        it("ending one session leaves the other session's mutes", async () => {
            const service = createParallelService();
            await startBoth(service);
            expect([...fx.voice.muted].sort()).toEqual(["u1", "u2", "u3", "u4"]);

            await service.endSession(GUILD, "A");

            expect([...fx.voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await fx.ledgerIds()).toEqual(["u3", "u4"]);
        });

        it("lobby of one session releases only its members", async () => {
            const service = createParallelService();
            await startBoth(service);

            await service.handleGameEvent(eventOf("A", "lobby", []));

            expect([...fx.voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await fx.sessionIsActive(service, "B")).toBe(true);
            expect(await fx.sessionIsActive(service, "A")).toBe(false);
        });

        it("a member moved to another game is released only by that game", async () => {
            const service = createParallelService();
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            fx.voice.channels.set("c1", ["u1"]);
            fx.voice.channels.set("c2", ["u3", "u2"]);
            await service.handleGameEvent(eventOf("B", "game-start", ["Green", "Blue"]));
            expect(await fx.db.muteLedger.get(GUILD, "u2")).toMatchObject({ sessionId: "B" });

            await service.endSession(GUILD, "A");
            expect([...fx.voice.muted].sort()).toEqual(["u2", "u3"]);

            await service.endSession(GUILD, "B");
            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("delayed event of session A is not dropped by an event of session B", async () => {
            fx.settings = {
                ...DEFAULT_SETTINGS,
                delaysMs: { gameStart: 3000, meetingStart: 0, meetingEnd: 0, lobby: 0 },
            };
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createParallelService();

            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            await service.handleGameEvent(eventOf("B", "meeting-end", ["Green", "Yellow"]));
            expect([...fx.voice.muted].sort()).toEqual(["u3", "u4"]);
            wake[0]();

            await vi.waitFor(() => expect([...fx.voice.muted].sort()).toEqual(["u1", "u2", "u3", "u4"]));
        });

        it("sweepIdle releases rows of sessions that are no longer active", async () => {
            const service = createParallelService();
            await startBoth(service);
            fx.voice.channels.set("c3", ["u8", "u9"]);
            fx.voice.muted.add("u8").add("u9");
            await fx.db.muteLedger.set(GUILD, "u8", { muted: true, deafened: false }, "ended-session");
            await fx.db.muteLedger.set(GUILD, "u9", { muted: true, deafened: false }, null);

            await service.sweepIdle([GUILD]);

            expect([...fx.voice.muted].sort()).toEqual(["u1", "u2", "u3", "u4"]);
            expect(await fx.ledgerIds()).toEqual(["u1", "u2", "u3", "u4"]);
        });

        it("releaseIfIdle lifts a row of an ended session while another game runs", async () => {
            const service = createParallelService();
            await startBoth(service);
            fx.voice.leave("u1");
            await service.endSession(GUILD, "A");
            expect(await fx.ledgerIds()).toEqual(["u1", "u3", "u4"]);

            fx.voice.channels.set("c3", ["u1"]);
            await service.releaseIfIdle(GUILD, "u1");

            expect([...fx.voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await fx.ledgerIds()).toEqual(["u3", "u4"]);
        });

        it("a game event that arrives after its session ended is dropped", async () => {
            const service = createParallelService();
            await startBoth(service);
            await service.endSession(GUILD, "A");
            expect(service.hasEnded("A")).toBe(true);
            expect(service.hasEnded("B")).toBe(false);

            expect(await service.handleGameEvent(eventOf("A", "meeting-end", ["Red", "Blue"]))).toEqual({ ok: true });

            expect([...fx.voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await fx.sessionIsActive(service, "A")).toBe(false);
        });

        it("endGuild ends every game of the guild and lifts all its mutes", async () => {
            const service = createParallelService();
            await startBoth(service);

            await service.endGuild(GUILD);

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
            expect([service.hasEnded("A"), service.hasEnded("B")]).toEqual([true, true]);
            await service.handleGameEvent(eventOf("A", "meeting-end", ["Red", "Blue"]));
            expect(fx.voice.muted.size).toBe(0);
        });

        it("endGuild drops an event of the guild that still waits out its delay", async () => {
            fx.settings = {
                ...DEFAULT_SETTINGS,
                delaysMs: { gameStart: 0, meetingStart: 0, meetingEnd: 3000, lobby: 0 },
            };
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createParallelService();
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            await service.handleGameEvent(eventOf("A", "meeting-end", ["Red", "Blue"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));

            await service.endGuild(GUILD);
            wake[0]();

            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("endGuild drops a game start that arrives while the guild is left, until reopenGuild", async () => {
            const service = createParallelService();
            await service.endGuild(GUILD);

            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);

            service.reopenGuild(GUILD);
            await service.handleGameEvent(eventOf("B", "game-start", ["Green", "Yellow"]));
            expect([...fx.voice.muted].sort()).toEqual(["u3", "u4"]);
        });

        it("keeps a guild closed while a second, overlapping leave is still running", async () => {
            const service = createParallelService();
            await service.endGuild(GUILD);
            await service.endGuild(GUILD);

            service.reopenGuild(GUILD);
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            expect(fx.voice.muted.size).toBe(0);

            service.reopenGuild(GUILD);
            await service.handleGameEvent(eventOf("B", "game-start", ["Green", "Yellow"]));
            expect([...fx.voice.muted].sort()).toEqual(["u3", "u4"]);
        });

        it("endGuild cancels the delayed game start of a game that is still in the lobby", async () => {
            fx.settings = {
                ...DEFAULT_SETTINGS,
                delaysMs: { gameStart: 3000, meetingStart: 0, meetingEnd: 0, lobby: 0 },
            };
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createParallelService();
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));

            await service.endGuild(GUILD);
            service.reopenGuild(GUILD);
            wake[0]();

            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("recover still releases every row", async () => {
            await startBoth(createParallelService());

            await createParallelService().recover([GUILD]);

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("ledger row carries the session before the mute call", async () => {
            const seen: Array<string | null | undefined> = [];
            fx.voice.beforeSetMute = async (discordId, mute) => {
                if (mute) seen.push((await fx.db.muteLedger.get(GUILD, discordId))?.sessionId);
            };

            await startBoth(createParallelService());

            expect(seen).toEqual(["A", "A", "B", "B"]);
        });
    });
});
