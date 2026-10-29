import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { logger } from "../../src/Logging/Logger";
import { MuteService, type VoiceAdapter, type VoiceMember } from "../../src/Mute/MuteService";
import type { VoiceTarget } from "../../src/Mute/VoiceTarget";
import type { GameEventName } from "../../src/Protocol/PluginProtocol";
import type { ClusterRequest } from "../../src/Routing/Messages";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";
import { createTestDatabase } from "../Helpers/TestDatabase";

type GameEventRequest = Extract<ClusterRequest, { kind: "game-event" }>;

const GUILD = "g1";

class FakeVoice implements VoiceAdapter {
    readonly channels = new Map<string, string[]>();
    readonly muted = new Set<string>();
    readonly deafened = new Set<string>();
    readonly bots = new Set<string>();
    readonly failing = new Set<string>();
    readonly failOnce = new Set<string>();
    readonly failingChannels = new Set<string>();
    readonly calls: Array<{ discordId: string; mute: boolean }> = [];
    readonly stateCalls: Array<{ discordId: string; patch: { mute?: boolean; deaf?: boolean } }> = [];
    delay: () => number = () => 0;
    beforeSetMute: (discordId: string, mute: boolean) => Promise<void> = async () => {};
    afterSetMute: (discordId: string, mute: boolean) => void = () => {};

    private async wait(): Promise<void> {
        const ms = this.delay();
        if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private member(discordId: string): VoiceMember {
        return {
            discordId,
            serverMuted: this.muted.has(discordId),
            serverDeafened: this.deafened.has(discordId),
            isBot: this.bots.has(discordId),
        };
    }

    async membersInChannel(_guildId: string, channelId: string): Promise<VoiceMember[]> {
        await this.wait();
        if (this.failingChannels.has(channelId)) throw new Error("Unknown Channel");
        return (this.channels.get(channelId) ?? []).map((id) => this.member(id));
    }

    async findVoiceMember(_guildId: string, discordId: string): Promise<VoiceMember | null> {
        await this.wait();
        const inVoice = [...this.channels.values()].some((members) => members.includes(discordId));
        return inVoice ? this.member(discordId) : null;
    }

    async setVoiceState(_guildId: string, discordId: string, patch: { mute?: boolean; deaf?: boolean }): Promise<void> {
        await this.wait();
        await this.beforeSetMute(discordId, patch.mute === true);
        this.stateCalls.push({ discordId, patch });
        if (patch.mute !== undefined) this.calls.push({ discordId, mute: patch.mute });
        if (this.failing.has(discordId)) throw new Error("Missing Permissions");
        if (this.failOnce.delete(discordId)) throw new Error("Service Unavailable");
        if (patch.mute === true) this.muted.add(discordId);
        if (patch.mute === false) this.muted.delete(discordId);
        if (patch.deaf === true) this.deafened.add(discordId);
        if (patch.deaf === false) this.deafened.delete(discordId);
        this.afterSetMute(discordId, patch.mute === true);
    }

    leave(discordId: string): void {
        for (const [channelId, members] of this.channels) {
            this.channels.set(
                channelId,
                members.filter((id) => id !== discordId),
            );
        }
    }
}

function gameEvent(event: GameEventName, players: string[], deadPlayers: string[] = []): GameEventRequest {
    return { kind: "game-event", guildId: GUILD, sessionId: "s1", hostAccountName: "Red", event, players, deadPlayers };
}

describe("MuteService", () => {
    let db: Database;
    let voice: FakeVoice;
    let target: VoiceTarget;
    let settings: GuildSettings;
    let sleep: (ms: number) => Promise<void>;

    function createService(): MuteService {
        return new MuteService({
            voice,
            links: db.links,
            ledger: db.muteLedger,
            resolveTarget: async () => target,
            settings: { get: async () => settings },
            sleep: (ms) => sleep(ms),
        });
    }

    /** releaseIfIdle lifts a left-behind mute only while its session does not run, which makes the session observable. */
    async function sessionIsActive(service: MuteService, sessionId = "s1", guildId = GUILD): Promise<boolean> {
        const probe = "session-probe";
        const callsBefore = voice.calls.length;
        voice.channels.set("probe-channel", [probe]);
        voice.muted.add(probe);
        await db.muteLedger.add(guildId, probe, sessionId);

        await service.releaseIfIdle(guildId, probe);
        const active = voice.muted.has(probe);

        voice.channels.delete("probe-channel");
        voice.muted.delete(probe);
        voice.calls.splice(callsBefore);
        await db.muteLedger.remove(guildId, probe);
        return active;
    }

    async function ledgerIds(): Promise<string[]> {
        return (await db.muteLedger.listByGuild(GUILD)).map((e) => e.discordId).sort();
    }

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        db = await createTestDatabase();
        voice = new FakeVoice();
        target = { channelIds: ["c1"] };
        settings = DEFAULT_SETTINGS;
        sleep = async () => {};
        await db.links.upsert(GUILD, "u1", "Red");
        await db.links.upsert(GUILD, "u2", "Blue");
        await db.links.upsert(GUILD, "u3", "Green");
    });

    afterEach(async () => {
        await db.close();
        vi.restoreAllMocks();
    });

    it("mutes only members in the target channel", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        voice.channels.set("c2", ["u3"]);
        const reply = await createService().handleGameEvent(gameEvent("game-start", ["Red", "Blue", "Green"]));

        expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
        expect([...voice.muted].sort()).toEqual(["u1", "u2"]);
        expect(await ledgerIds()).toEqual(["u1", "u2"]);
    });

    it("spans every target channel", async () => {
        target = { channelIds: ["c1", "c2"] };
        voice.channels.set("c1", ["u1"]);
        voice.channels.set("c2", ["u3"]);
        await createService().handleGameEvent(gameEvent("game-start", ["Red", "Green"]));
        expect([...voice.muted].sort()).toEqual(["u1", "u3"]);
    });

    it("does not unmute a member muted by a moderator", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        voice.muted.add("u2");
        const service = createService();

        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        expect(await ledgerIds()).toEqual(["u1"]);

        await service.handleGameEvent(gameEvent("meeting-start", ["Red", "Blue"]));
        expect([...voice.muted]).toEqual(["u2"]);
        expect(voice.calls.filter((c) => c.discordId === "u2")).toEqual([]);

        await service.endSession(GUILD, "s1");
        expect([...voice.muted]).toEqual(["u2"]);
    });

    it("returns the target notice and changes nothing", async () => {
        voice.channels.set("c1", ["u1"]);
        target = { notice: { code: "host-not-in-voice", message: "Join a voice channel" } };
        const reply = await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(reply).toEqual({ ok: true, notice: target.notice });
        expect(voice.calls).toEqual([]);
        expect(await ledgerIds()).toEqual([]);
    });

    it("reports a missing voice permission on the event bus", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        voice.beforeSetMute = async (discordId) => {
            if (discordId === "u1") throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
            if (discordId === "u2") throw new Error("Unknown Member");
        };
        const emitted: GuildEvent[] = [];
        const service = new MuteService({
            voice,
            links: db.links,
            ledger: db.muteLedger,
            resolveTarget: async () => target,
            settings: { get: async () => settings },
            events: { emit: (e) => emitted.push(e) },
        });

        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

        expect(emitted).toEqual([{ type: "voice-error", guildId: GUILD, code: "missing-permission", discordId: "u1" }]);
        expect(await ledgerIds()).toEqual([]);
    });

    it("ledger survives restart and recover unmutes", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        await createService().handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        expect(await ledgerIds()).toEqual(["u1", "u2"]);

        voice.leave("u2");
        const restarted = createService();
        await restarted.recover([GUILD]);

        expect([...voice.muted]).toEqual(["u2"]);
        expect(await ledgerIds()).toEqual(["u2"]);
    });

    it("events apply in order under burst", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        voice.delay = () => Math.floor(Math.random() * 4);
        const service = createService();

        const events = Array.from({ length: 20 }, (_, i) =>
            gameEvent(i % 2 === 0 ? "game-start" : "meeting-start", ["Red"], ["Blue"]),
        );
        const replies = await Promise.all(events.map((e) => service.handleGameEvent(e)));

        expect(replies.every((r) => r.ok)).toBe(true);
        expect([...voice.muted]).toEqual(["u2"]);
        expect(await ledgerIds()).toEqual(["u2"]);
        const u1Calls = voice.calls.filter((c) => c.discordId === "u1").map((c) => c.mute);
        expect(u1Calls).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 === 0));
    });

    it("endSession unmutes ledger members in voice", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        voice.channels.set("c2", ["u3"]);
        const service = createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        voice.leave("u2");
        voice.leave("u1");
        voice.channels.set("c2", ["u1", "u3"]);

        await service.endSession(GUILD, "s1");

        expect([...voice.muted]).toEqual(["u2"]);
        expect(await ledgerIds()).toEqual(["u2"]);
        expect(await sessionIsActive(service)).toBe(false);
    });

    it("lobby unmutes every ledger member in voice", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        const service = createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

        await service.handleGameEvent(gameEvent("lobby", []));

        expect(voice.muted.size).toBe(0);
        expect(await ledgerIds()).toEqual([]);
    });

    it("drops a ledger entry whose member was already unmuted elsewhere", async () => {
        voice.channels.set("c1", ["u1"]);
        const service = createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        voice.muted.delete("u1");
        voice.calls.length = 0;

        await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));

        expect(voice.calls).toEqual([]);
        expect(await ledgerIds()).toEqual([]);
    });

    it("one failing member does not stop the others", async () => {
        voice.channels.set("c1", ["u1", "u2", "u3"]);
        voice.failing.add("u2");
        const service = createService();

        const reply = await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue", "Green"]));

        expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
        expect([...voice.muted].sort()).toEqual(["u1", "u3"]);
        expect(await ledgerIds()).toEqual(["u1", "u3"]);
        expect(logger.error).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringMatching(new RegExp(`${GUILD}.*u2`)),
            expect.any(Error),
        );

        voice.failing.clear();
        voice.failing.add("u1");
        await service.endSession(GUILD, "s1");
        expect([...voice.muted]).toEqual(["u1"]);
        expect(await ledgerIds()).toEqual(["u1"]);
    });

    it("tracks the active session", async () => {
        voice.channels.set("c1", ["u1"]);
        const service = createService();
        expect(await sessionIsActive(service)).toBe(false);

        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        expect(await sessionIsActive(service)).toBe(true);
        expect(await sessionIsActive(service, "s1", "other")).toBe(false);

        await service.handleGameEvent(gameEvent("lobby", ["Red"]));
        expect(await sessionIsActive(service)).toBe(false);

        await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));
        expect(await sessionIsActive(service)).toBe(true);
        await service.endSession(GUILD, "s1");
        expect(await sessionIsActive(service)).toBe(false);
    });

    it("ignores endSession of a replaced session", async () => {
        voice.channels.set("c1", ["u1"]);
        const service = createService();
        await service.handleGameEvent({ ...gameEvent("game-start", ["Red"]), sessionId: "s2" });

        await service.endSession(GUILD, "s1");

        expect(await sessionIsActive(service, "s2")).toBe(true);
        expect([...voice.muted]).toEqual(["u1"]);
    });

    it("returns an error reply and logs when the database is closed", async () => {
        voice.channels.set("c1", ["u1"]);
        const service = createService();
        await db.close();

        const reply = await service.handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(reply).toEqual({ ok: false, error: "mute update failed" });
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(GUILD), expect.anything());
        expect(voice.calls).toEqual([]);
        db = await createTestDatabase();
    });

    it("writes the ledger row before muting", async () => {
        voice.channels.set("c1", ["u1"]);
        const seen: string[][] = [];
        voice.beforeSetMute = async (_id, mute) => {
            if (mute) seen.push(await ledgerIds());
        };

        await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(seen).toEqual([["u1"]]);
    });

    it("a failing mute leaves no stale ledger row", async () => {
        voice.channels.set("c1", ["u1"]);
        voice.failing.add("u1");

        await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(voice.muted.size).toBe(0);
        expect(await ledgerIds()).toEqual([]);
    });

    it("recover reads the ledger after earlier queued work", async () => {
        voice.channels.set("c1", ["u1"]);
        const service = createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        voice.afterSetMute = (id, mute) => {
            if (!mute) voice.muted.add(id);
        };

        await Promise.all([service.handleGameEvent(gameEvent("lobby", [])), service.recover([GUILD])]);

        expect([...voice.muted]).toEqual(["u1"]);
        expect(voice.calls.filter((c) => !c.mute)).toHaveLength(1);
        expect(await ledgerIds()).toEqual([]);
    });

    it("lobby and recover leave moderator mutes alone", async () => {
        voice.channels.set("c1", ["u1", "u2"]);
        voice.muted.add("u2");
        const service = createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

        await service.handleGameEvent(gameEvent("lobby", ["Red", "Blue"]));
        expect([...voice.muted]).toEqual(["u2"]);

        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        await createService().recover([GUILD]);
        expect([...voice.muted]).toEqual(["u2"]);
        expect(voice.calls.filter((c) => c.discordId === "u2")).toEqual([]);
    });

    it("a newer session takes over and a late endSession of the old session is ignored", async () => {
        voice.channels.set("c1", ["u1"]);
        const service = createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        await service.handleGameEvent({ ...gameEvent("meeting-end", ["Red"]), sessionId: "s2" });

        await service.endSession(GUILD, "s1");
        expect(await sessionIsActive(service, "s2")).toBe(true);
        expect([...voice.muted]).toEqual(["u1"]);
        expect(voice.calls.filter((c) => !c.mute)).toEqual([]);

        await service.endSession(GUILD, "s2");
        expect(await sessionIsActive(service, "s2")).toBe(false);
        expect(voice.muted.size).toBe(0);
    });

    it("a failing channel does not stop the other channels", async () => {
        target = { channelIds: ["bad", "c1"] };
        voice.failingChannels.add("bad");
        voice.channels.set("c1", ["u1"]);

        const reply = await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(reply).toEqual({ ok: true, channelIds: ["bad", "c1"] });
        expect([...voice.muted]).toEqual(["u1"]);
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("bad"), expect.any(Error));
    });

    describe("voice rules", () => {
        const ghostChat = (): GuildSettings => ({ ...DEFAULT_SETTINGS, ghostChat: true });

        it("ghost chat deafens the living and frees the dead during tasks, and lifts both in the lobby", async () => {
            settings = ghostChat();
            voice.channels.set("c1", ["u1", "u2"]);
            const service = createService();

            await service.handleGameEvent(gameEvent("game-start", ["Red"], ["Blue"]));

            expect(voice.stateCalls).toEqual([{ discordId: "u1", patch: { mute: true, deaf: true } }]);
            expect(await db.muteLedger.get(GUILD, "u1")).toMatchObject({ muted: true, deafened: true });
            expect(await db.muteLedger.get(GUILD, "u2")).toBeNull();

            await service.handleGameEvent(gameEvent("lobby", []));

            expect(voice.muted.size).toBe(0);
            expect(voice.deafened.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("keeps a member deafened by a moderator deafened after the lobby", async () => {
            settings = ghostChat();
            voice.channels.set("c1", ["u1"]);
            voice.deafened.add("u1");
            const service = createService();

            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(voice.stateCalls).toEqual([{ discordId: "u1", patch: { mute: true } }]);
            expect(await db.muteLedger.get(GUILD, "u1")).toMatchObject({ muted: true, deafened: false });

            await service.handleGameEvent(gameEvent("lobby", []));

            expect([...voice.deafened]).toEqual(["u1"]);
            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("lifts only the deafen when the phase changes from deafen to mute", async () => {
            settings = {
                ...DEFAULT_SETTINGS,
                voiceRules: { tasks: { alive: "deafen", dead: "mute" }, meeting: { alive: "mute", dead: "mute" } },
            };
            voice.channels.set("c1", ["u1"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            voice.stateCalls.length = 0;

            await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));

            expect(voice.stateCalls).toEqual([{ discordId: "u1", patch: { deaf: false } }]);
            expect(await db.muteLedger.get(GUILD, "u1")).toMatchObject({ muted: true, deafened: false });
        });

        it("mutes unlinked members while a game runs and frees them in the lobby", async () => {
            settings = { ...DEFAULT_SETTINGS, nonPlayers: "mute" };
            voice.channels.set("c1", ["u1", "u9", "bot1"]);
            voice.bots.add("bot1");
            const service = createService();

            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            expect([...voice.muted].sort()).toEqual(["u1", "u9"]);
            expect(voice.calls.some((c) => c.discordId === "bot1")).toBe(false);

            await service.handleGameEvent(gameEvent("lobby", []));

            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("leaves unlinked members and bots alone by default", async () => {
            voice.channels.set("c1", ["u1", "u9", "bot1"]);
            voice.bots.add("bot1");

            await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect([...voice.muted]).toEqual(["u1"]);
        });

        it("treats non-players like the dead when asked to", async () => {
            settings = {
                ...DEFAULT_SETTINGS,
                nonPlayers: "as-dead",
                voiceRules: { tasks: { alive: "mute", dead: "mute" }, meeting: { alive: "free", dead: "deafen" } },
            };
            voice.channels.set("c1", ["u1", "u9"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));

            expect([...voice.deafened]).toEqual(["u9"]);
            expect([...voice.muted].sort()).toEqual(["u9"]);
        });
    });

    describe("delays", () => {
        it("skips a delayed event when a newer one arrived", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            const sleeps: number[] = [];
            sleep = (ms) => {
                sleeps.push(ms);
                return new Promise<void>((resolve) => wake.push(resolve));
            };
            const service = createService();

            const start = service.handleGameEvent(gameEvent("game-start", ["Red"]));
            const lobby = await service.handleGameEvent(gameEvent("lobby", []));
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            wake[0]();
            const startReply = await start;
            expect(await sessionIsActive(service)).toBe(false);

            expect(sleeps).toEqual([3000]);
            expect(lobby).toEqual({ ok: true });
            expect(startReply).toEqual({ ok: true, channelIds: ["c1"] });
            expect(voice.calls).toEqual([]);
            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("applies a delayed event nobody replaced", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            voice.channels.set("c1", ["u1"]);
            const sleeps: number[] = [];
            sleep = async (ms) => {
                sleeps.push(ms);
            };

            const reply = await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(sleeps).toEqual([3000]);
            expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
            await vi.waitFor(() => expect([...voice.muted]).toEqual(["u1"]));
        });

        it("answers a delayed event before the delay elapses", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            sleep = () => new Promise<void>((resolve) => wake.push(resolve));

            const reply = await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
            expect(voice.calls).toEqual([]);
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            wake[0]();
            await vi.waitFor(() => expect([...voice.muted]).toEqual(["u1"]));
            expect(await ledgerIds()).toEqual(["u1"]);
        });

        it("still returns the channels or the notice for a delayed event", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createService();

            expect(await service.handleGameEvent(gameEvent("game-start", ["Red"]))).toEqual({
                ok: true,
                channelIds: ["c1"],
            });

            target = { notice: { code: "host-not-in-voice", message: "Join a voice channel" } };
            expect(await service.handleGameEvent(gameEvent("game-start", ["Red"]))).toEqual({
                ok: true,
                notice: target.notice,
            });
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            expect(voice.calls).toEqual([]);
        });

        it("keeps a newer session's pending event when an old session ends", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createService();
            await service.handleGameEvent(gameEvent("meeting-end", ["Red"]));
            await service.handleGameEvent({ ...gameEvent("game-start", ["Red"]), sessionId: "s2" });
            await vi.waitFor(() => expect(wake).toHaveLength(1));

            await service.endSession(GUILD, "s1");
            wake[0]();

            await vi.waitFor(() => expect(voice.calls.filter((c) => c.mute)).toHaveLength(2));
            expect([...voice.muted]).toEqual(["u1"]);
            expect(await sessionIsActive(service, "s2")).toBe(true);
        });

        it("keeps meeting rules when a death arrives during a meeting", async () => {
            voice.channels.set("c1", ["u1", "u2"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
            await service.handleGameEvent(gameEvent("meeting-start", ["Red", "Blue"]));
            expect(voice.muted.size).toBe(0);

            await service.handleGameEvent(gameEvent("player-died", ["Blue"], ["Red"]));

            expect([...voice.muted]).toEqual(["u1"]);
            await service.handleGameEvent(gameEvent("meeting-end", ["Blue"], ["Red"]));
            expect([...voice.muted].sort()).toEqual(["u1", "u2"]);
        });

        it("applies task rules for a death outside a meeting", async () => {
            voice.channels.set("c1", ["u1", "u2"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

            await service.handleGameEvent(gameEvent("player-died", ["Blue"], ["Red"]));

            expect([...voice.muted].sort()).toEqual(["u1", "u2"]);
        });

        it("does not cancel a delayed meeting start when a death arrives", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, meetingStart: 3000 } };
            voice.channels.set("c1", ["u1", "u2"]);
            const wake: Array<() => void> = [];
            sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
            await service.handleGameEvent(gameEvent("meeting-start", ["Red", "Blue"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));

            await service.handleGameEvent(gameEvent("player-died", ["Blue"], ["Red"]));
            expect([...voice.muted].sort()).toEqual(["u1", "u2"]);
            wake[0]();

            await vi.waitFor(() => expect([...voice.muted]).toEqual(["u1"]));
        });

        it("never sleeps for events without a delay", async () => {
            voice.channels.set("c1", ["u1"]);
            const sleeps: number[] = [];
            sleep = async (ms) => {
                sleeps.push(ms);
            };

            await createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(sleeps).toEqual([]);
        });

        it("never applies delays to the end of a session", async () => {
            settings = {
                ...DEFAULT_SETTINGS,
                delaysMs: { gameStart: 0, meetingStart: 0, meetingEnd: 0, lobby: 0 },
            };
            voice.channels.set("c1", ["u1"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            settings = {
                ...DEFAULT_SETTINGS,
                delaysMs: { gameStart: 5000, meetingStart: 5000, meetingEnd: 5000, lobby: 5000 },
            };
            const sleeps: number[] = [];
            sleep = async (ms) => {
                sleeps.push(ms);
            };

            await service.endSession(GUILD, "s1");
            await service.recover([GUILD]);

            expect(sleeps).toEqual([]);
            expect(voice.muted.size).toBe(0);
        });

        it("drops a delayed event that wakes up after its session ended", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { ...DEFAULT_SETTINGS.delaysMs, gameStart: 3000 } };
            voice.channels.set("c1", ["u1"]);
            const wake: Array<() => void> = [];
            sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createService();
            await service.handleGameEvent({ ...gameEvent("meeting-end", ["Red"]) });

            const start = service.handleGameEvent(gameEvent("game-start", ["Red"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            await service.endSession(GUILD, "s1");
            wake[0]();
            await start;

            expect(voice.muted.size).toBe(0);
            expect(await sessionIsActive(service)).toBe(false);
        });
    });

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
                voice,
                links: db.links,
                ledger: db.muteLedger,
                resolveTarget: async (_guildId, host) => ({
                    channelIds: [host === "Red" ? HOSTS.A.channelId : HOSTS.B.channelId],
                }),
                settings: { get: async () => settings },
                sleep: (ms) => sleep(ms),
            });
        }

        async function startBoth(service: MuteService): Promise<void> {
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            await service.handleGameEvent(eventOf("B", "game-start", ["Green", "Yellow"]));
        }

        beforeEach(async () => {
            await db.links.upsert(GUILD, "u4", "Yellow");
            voice.channels.set("c1", ["u1", "u2"]);
            voice.channels.set("c2", ["u3", "u4"]);
        });

        it("ending one session leaves the other session's mutes", async () => {
            const service = createParallelService();
            await startBoth(service);
            expect([...voice.muted].sort()).toEqual(["u1", "u2", "u3", "u4"]);

            await service.endSession(GUILD, "A");

            expect([...voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await ledgerIds()).toEqual(["u3", "u4"]);
        });

        it("lobby of one session releases only its members", async () => {
            const service = createParallelService();
            await startBoth(service);

            await service.handleGameEvent(eventOf("A", "lobby", []));

            expect([...voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await sessionIsActive(service, "B")).toBe(true);
            expect(await sessionIsActive(service, "A")).toBe(false);
        });

        it("a member moved to another game is released only by that game", async () => {
            const service = createParallelService();
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            voice.channels.set("c1", ["u1"]);
            voice.channels.set("c2", ["u3", "u2"]);
            await service.handleGameEvent(eventOf("B", "game-start", ["Green", "Blue"]));
            expect(await db.muteLedger.get(GUILD, "u2")).toMatchObject({ sessionId: "B" });

            await service.endSession(GUILD, "A");
            expect([...voice.muted].sort()).toEqual(["u2", "u3"]);

            await service.endSession(GUILD, "B");
            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("delayed event of session A is not dropped by an event of session B", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { gameStart: 3000, meetingStart: 0, meetingEnd: 0, lobby: 0 } };
            const wake: Array<() => void> = [];
            sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createParallelService();

            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));
            await service.handleGameEvent(eventOf("B", "meeting-end", ["Green", "Yellow"]));
            expect([...voice.muted].sort()).toEqual(["u3", "u4"]);
            wake[0]();

            await vi.waitFor(() => expect([...voice.muted].sort()).toEqual(["u1", "u2", "u3", "u4"]));
        });

        it("sweepIdle releases rows of sessions that are no longer active", async () => {
            const service = createParallelService();
            await startBoth(service);
            voice.channels.set("c3", ["u8", "u9"]);
            voice.muted.add("u8").add("u9");
            await db.muteLedger.add(GUILD, "u8", "ended-session");
            await db.muteLedger.add(GUILD, "u9");

            await service.sweepIdle([GUILD]);

            expect([...voice.muted].sort()).toEqual(["u1", "u2", "u3", "u4"]);
            expect(await ledgerIds()).toEqual(["u1", "u2", "u3", "u4"]);
        });

        it("releaseIfIdle lifts a row of an ended session while another game runs", async () => {
            const service = createParallelService();
            await startBoth(service);
            voice.leave("u1");
            await service.endSession(GUILD, "A");
            expect(await ledgerIds()).toEqual(["u1", "u3", "u4"]);

            voice.channels.set("c3", ["u1"]);
            await service.releaseIfIdle(GUILD, "u1");

            expect([...voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await ledgerIds()).toEqual(["u3", "u4"]);
        });

        it("a game event that arrives after its session ended is dropped", async () => {
            const service = createParallelService();
            await startBoth(service);
            await service.endSession(GUILD, "A");
            expect(service.hasEnded("A")).toBe(true);
            expect(service.hasEnded("B")).toBe(false);

            expect(await service.handleGameEvent(eventOf("A", "meeting-end", ["Red", "Blue"]))).toEqual({ ok: true });

            expect([...voice.muted].sort()).toEqual(["u3", "u4"]);
            expect(await sessionIsActive(service, "A")).toBe(false);
        });

        it("endGuild ends every game of the guild and lifts all its mutes", async () => {
            const service = createParallelService();
            await startBoth(service);

            await service.endGuild(GUILD);

            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
            expect([service.hasEnded("A"), service.hasEnded("B")]).toEqual([true, true]);
            await service.handleGameEvent(eventOf("A", "meeting-end", ["Red", "Blue"]));
            expect(voice.muted.size).toBe(0);
        });

        it("endGuild drops an event of the guild that still waits out its delay", async () => {
            settings = { ...DEFAULT_SETTINGS, delaysMs: { gameStart: 0, meetingStart: 0, meetingEnd: 3000, lobby: 0 } };
            const wake: Array<() => void> = [];
            sleep = () => new Promise<void>((resolve) => wake.push(resolve));
            const service = createParallelService();
            await service.handleGameEvent(eventOf("A", "game-start", ["Red", "Blue"]));
            await service.handleGameEvent(eventOf("A", "meeting-end", ["Red", "Blue"]));
            await vi.waitFor(() => expect(wake).toHaveLength(1));

            await service.endGuild(GUILD);
            wake[0]();

            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("recover still releases every row", async () => {
            await startBoth(createParallelService());

            await createParallelService().recover([GUILD]);

            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("ledger row carries the session before the mute call", async () => {
            const seen: Array<string | null | undefined> = [];
            voice.beforeSetMute = async (discordId, mute) => {
                if (mute) seen.push((await db.muteLedger.get(GUILD, discordId))?.sessionId);
            };

            await startBoth(createParallelService());

            expect(seen).toEqual(["A", "A", "B", "B"]);
        });
    });

    describe("sweepIdle", () => {
        it("retries an unmute that failed earlier", async () => {
            voice.channels.set("c1", ["u1"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            voice.failOnce.add("u1");
            await service.handleGameEvent(gameEvent("lobby", []));
            expect([...voice.muted]).toEqual(["u1"]);
            expect(await ledgerIds()).toEqual(["u1"]);

            await service.sweepIdle([GUILD, "other"]);

            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("does nothing while a session is active", async () => {
            voice.channels.set("c1", ["u1"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            voice.calls.length = 0;

            await service.sweepIdle([GUILD]);

            expect([...voice.muted]).toEqual(["u1"]);
            expect(voice.calls).toEqual([]);
        });

        it("asks the ledger once for all guilds", async () => {
            const listByGuilds = vi.spyOn(db.muteLedger, "listByGuilds");
            const listByGuild = vi.spyOn(db.muteLedger, "listByGuild");

            await createService().sweepIdle([GUILD, "g2", "g3"]);

            expect(listByGuilds).toHaveBeenCalledTimes(1);
            expect(listByGuild).not.toHaveBeenCalled();
        });
    });

    describe("releaseIfIdle", () => {
        it("unmutes a ledger member who rejoins voice after the session ended", async () => {
            voice.channels.set("c1", ["u1"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            voice.leave("u1");
            await service.endSession(GUILD, "s1");
            expect(await ledgerIds()).toEqual(["u1"]);

            voice.channels.set("c2", ["u1"]);
            await service.releaseIfIdle(GUILD, "u1");

            expect(voice.muted.size).toBe(0);
            expect(await ledgerIds()).toEqual([]);
        });

        it("keeps the mute while a session is active", async () => {
            voice.channels.set("c1", ["u1"]);
            const service = createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            await service.releaseIfIdle(GUILD, "u1");

            expect([...voice.muted]).toEqual(["u1"]);
            expect(await ledgerIds()).toEqual(["u1"]);
        });

        it("checks the ledger entry of the member only", async () => {
            await db.muteLedger.add(GUILD, "u1");
            voice.channels.set("c1", ["u1"]);
            voice.muted.add("u1");
            const listByGuild = vi.spyOn(db.muteLedger, "listByGuild");

            await createService().releaseIfIdle(GUILD, "u1");

            expect(listByGuild).not.toHaveBeenCalled();
            expect(voice.muted.size).toBe(0);
        });

        it("leaves members outside the ledger alone", async () => {
            voice.channels.set("c1", ["u2"]);
            voice.muted.add("u2");

            await createService().releaseIfIdle(GUILD, "u2");

            expect(voice.calls).toEqual([]);
            expect([...voice.muted]).toEqual(["u2"]);
        });

        it("logs instead of throwing when the unmute fails", async () => {
            await db.muteLedger.add(GUILD, "u1");
            voice.channels.set("c1", ["u1"]);
            voice.muted.add("u1");
            voice.failing.add("u1");

            await expect(createService().releaseIfIdle(GUILD, "u1")).resolves.toBeUndefined();

            expect(logger.error).toHaveBeenCalled();
            expect(await ledgerIds()).toEqual(["u1"]);
        });
    });
});
