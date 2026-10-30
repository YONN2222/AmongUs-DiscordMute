import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { GUILD, gameEvent, useMuteServiceFixture } from "../Helpers/MuteServiceFixture";

describe("MuteService", () => {
    const fx = useMuteServiceFixture();

    describe("delays", () => {
        it("skips a delayed event when a newer one arrived", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            fx.voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            const sleeps: number[] = [];
            fx.sleep = (ms) => {
                sleeps.push(ms);
                return new Promise<void>((resolve) => wake.push(resolve));
            };
            const service = fx.createService();

            const start = service.handleGameEvent(gameEvent("game-start", ["Red"]));
            const lobby = await service.handleGameEvent(gameEvent("lobby", []));
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            wake[0]();
            const startReply = await start;
            expect(await fx.sessionIsActive(service)).toBe(false);

            expect(sleeps).toEqual([3000]);
            expect(lobby).toEqual({ ok: true });
            expect(startReply).toEqual({ ok: true, channelIds: ["c1"] });
            expect(fx.voice.calls).toEqual([]);
            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("applies a delayed event nobody replaced", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            fx.voice.channels.set("c1", ["u1"]);
            const sleeps: number[] = [];
            fx.sleep = async (ms) => {
                sleeps.push(ms);
            };

            const reply = await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(sleeps).toEqual([3000]);
            expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
            await vi.waitFor(() => expect([...fx.voice.muted]).toEqual(["u1"]));
        });

        it("answers a delayed event before the delay elapses", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            fx.voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));

            const reply = await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
            expect(fx.voice.calls).toEqual([]);
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            wake[0]();
            await vi.waitFor(() => expect([...fx.voice.muted]).toEqual(["u1"]));
            expect(await fx.ledgerIds()).toEqual(["u1"]);
        });

        it("still returns the channels or the notice for a delayed event", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            fx.voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = fx.createService();

            expect(await service.handleGameEvent(gameEvent("game-start", ["Red"]))).toEqual({
                ok: true,
                channelIds: ["c1"],
            });

            fx.target = { notice: { code: "host-not-in-voice", message: "Join a voice channel" } };
            expect(await service.handleGameEvent(gameEvent("game-start", ["Red"]))).toEqual({
                ok: true,
                notice: fx.target.notice,
            });
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            expect(fx.voice.calls).toEqual([]);
        });

        it("keeps a newer session's pending event when an old session ends", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            fx.voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("meeting-end", ["Red"]));
            await service.handleGameEvent({ ...gameEvent("game-start", ["Red"]), sessionId: "s2" });
            await vi.waitFor(() => expect(wake).toHaveLength(1));

            await service.endSession(GUILD, "s1");
            wake[0]();

            await vi.waitFor(() => expect(fx.voice.calls.filter((c) => c.mute)).toHaveLength(2));
            expect([...fx.voice.muted]).toEqual(["u1"]);
            expect(await fx.sessionIsActive(service, "s2")).toBe(true);
        });

        it("keeps meeting rules when a death arrives during a meeting", async () => {
            fx.voice.channels.set("c1", ["u1", "u2"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
            await service.handleGameEvent(gameEvent("meeting-start", ["Red", "Blue"]));
            expect(fx.voice.muted.size).toBe(0);

            await service.handleGameEvent(gameEvent("player-died", ["Blue"], ["Red"]));

            expect([...fx.voice.muted]).toEqual(["u1"]);
            await service.handleGameEvent(gameEvent("meeting-end", ["Blue"], ["Red"]));
            expect([...fx.voice.muted].sort()).toEqual(["u1", "u2"]);
        });

        it("applies task rules for a death outside a meeting", async () => {
            fx.voice.channels.set("c1", ["u1", "u2"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

            await service.handleGameEvent(gameEvent("player-died", ["Blue"], ["Red"]));

            expect([...fx.voice.muted].sort()).toEqual(["u1", "u2"]);
        });

        it("does not cancel a delayed meeting start when a death arrives", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, meetingStart: 3000 } };
            fx.voice.channels.set("c1", ["u1", "u2"]);
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
            await service.handleGameEvent(gameEvent("meeting-start", ["Red", "Blue"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));

            await service.handleGameEvent(gameEvent("player-died", ["Blue"], ["Red"]));
            expect([...fx.voice.muted].sort()).toEqual(["u1", "u2"]);
            wake[0]();

            await vi.waitFor(() => expect([...fx.voice.muted]).toEqual(["u1"]));
        });

        it("never sleeps for events without a delay", async () => {
            fx.voice.channels.set("c1", ["u1"]);
            const sleeps: number[] = [];
            fx.sleep = async (ms) => {
                sleeps.push(ms);
            };

            await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(sleeps).toEqual([]);
        });

        it("never applies delays to the end of a session", async () => {
            fx.settings = {
                ...DEFAULT_SETTINGS,
                delaysMs: { gameStart: 0, meetingStart: 0, meetingEnd: 0, lobby: 0 },
            };
            fx.voice.channels.set("c1", ["u1"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            fx.settings = {
                ...DEFAULT_SETTINGS,
                delaysMs: { gameStart: 5000, meetingStart: 5000, meetingEnd: 5000, lobby: 5000 },
            };
            const sleeps: number[] = [];
            fx.sleep = async (ms) => {
                sleeps.push(ms);
            };

            await service.endSession(GUILD, "s1");
            await service.recover([GUILD]);

            expect(sleeps).toEqual([]);
            expect(fx.voice.muted.size).toBe(0);
        });

        it("drops a delayed event that wakes up after its session ended", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            fx.voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            fx.sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = fx.createService();
            await service.handleGameEvent({ ...gameEvent("meeting-end", ["Red"]) });

            const start = service.handleGameEvent(gameEvent("game-start", ["Red"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            await service.endSession(GUILD, "s1");
            wake[0]();
            await start;

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.sessionIsActive(service)).toBe(false);
        });
    });
});
