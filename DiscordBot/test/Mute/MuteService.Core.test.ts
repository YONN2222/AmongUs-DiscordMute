import { describe, expect, it } from "vitest";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { logger } from "../../src/Logging/Logger";
import { MuteService } from "../../src/Mute/MuteService";
import { GUILD, gameEvent, missingPermission, useMuteServiceFixture } from "../Helpers/MuteServiceFixture";
import { createTestDatabase } from "../Helpers/TestDatabase";

describe("MuteService", () => {
    const fx = useMuteServiceFixture();

    it("mutes only members in the target channel", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        fx.voice.channels.set("c2", ["u3"]);
        const reply = await fx.createService().handleGameEvent(gameEvent("game-start", ["Red", "Blue", "Green"]));

        expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
        expect([...fx.voice.muted].sort()).toEqual(["u1", "u2"]);
        expect(await fx.ledgerIds()).toEqual(["u1", "u2"]);
    });

    it("spans every target channel", async () => {
        fx.target = { channelIds: ["c1", "c2"] };
        fx.voice.channels.set("c1", ["u1"]);
        fx.voice.channels.set("c2", ["u3"]);
        await fx.createService().handleGameEvent(gameEvent("game-start", ["Red", "Green"]));
        expect([...fx.voice.muted].sort()).toEqual(["u1", "u3"]);
    });

    it("does not unmute a member muted by a moderator", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        fx.voice.muted.add("u2");
        const service = fx.createService();

        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        expect(await fx.ledgerIds()).toEqual(["u1"]);

        await service.handleGameEvent(gameEvent("meeting-start", ["Red", "Blue"]));
        expect([...fx.voice.muted]).toEqual(["u2"]);
        expect(fx.voice.calls.filter((c) => c.discordId === "u2")).toEqual([]);

        await service.endSession(GUILD, "s1");
        expect([...fx.voice.muted]).toEqual(["u2"]);
    });

    it("returns the target notice and changes nothing", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        fx.target = { notice: { code: "host-not-in-voice", message: "Join a voice channel" } };
        const reply = await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(reply).toEqual({ ok: true, notice: fx.target.notice });
        expect(fx.voice.calls).toEqual([]);
        expect(await fx.ledgerIds()).toEqual([]);
    });

    it("reports a missing voice permission on the event bus", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        fx.voice.beforeSetMute = async (discordId) => {
            if (discordId === "u1") throw missingPermission();
            if (discordId === "u2") throw Object.assign(new Error("Unknown Member"), { code: 10007, status: 404 });
        };
        const emitted: GuildEvent[] = [];
        const service = new MuteService({
            voice: fx.voice,
            links: fx.db.links,
            ledger: fx.db.muteLedger,
            resolveTarget: async () => fx.target,
            settings: { get: async () => fx.settings },
            events: { emit: (e) => emitted.push(e) },
        });

        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

        expect(emitted).toEqual([{ type: "voice-error", guildId: GUILD, code: "missing-permission", discordId: "u1" }]);
        expect(await fx.ledgerIds()).toEqual([]);
    });

    it("ledger survives restart and recover unmutes", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        await fx.createService().handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        expect(await fx.ledgerIds()).toEqual(["u1", "u2"]);

        fx.voice.leave("u2");
        const restarted = fx.createService();
        await restarted.recover([GUILD]);

        expect([...fx.voice.muted]).toEqual(["u2"]);
        expect(await fx.ledgerIds()).toEqual(["u2"]);
    });

    it("events apply in order under burst", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        fx.voice.delay = () => Math.floor(Math.random() * 4);
        const service = fx.createService();

        const events = Array.from({ length: 20 }, (_, i) =>
            gameEvent(i % 2 === 0 ? "game-start" : "meeting-start", ["Red"], ["Blue"]),
        );
        const replies = await Promise.all(events.map((e) => service.handleGameEvent(e)));

        expect(replies.every((r) => r.ok)).toBe(true);
        expect([...fx.voice.muted]).toEqual(["u2"]);
        expect(await fx.ledgerIds()).toEqual(["u2"]);
        const u1Calls = fx.voice.calls.filter((c) => c.discordId === "u1").map((c) => c.mute);
        expect(u1Calls).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 === 0));
    });

    it("endSession unmutes ledger members in voice", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        fx.voice.channels.set("c2", ["u3"]);
        const service = fx.createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        fx.voice.leave("u2");
        fx.voice.leave("u1");
        fx.voice.channels.set("c2", ["u1", "u3"]);

        await service.endSession(GUILD, "s1");

        expect([...fx.voice.muted]).toEqual(["u2"]);
        expect(await fx.ledgerIds()).toEqual(["u2"]);
        expect(await fx.sessionIsActive(service)).toBe(false);
    });

    it("lobby unmutes every ledger member in voice", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        const service = fx.createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

        await service.handleGameEvent(gameEvent("lobby", []));

        expect(fx.voice.muted.size).toBe(0);
        expect(await fx.ledgerIds()).toEqual([]);
    });

    it("lifts a ledger mute even when the member already reads unmuted", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        const service = fx.createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        fx.voice.muted.delete("u1");
        fx.voice.calls.length = 0;

        await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));

        expect(fx.voice.calls).toEqual([{ discordId: "u1", mute: false }]);
        expect(await fx.ledgerIds()).toEqual([]);
    });

    it("one failing member does not stop the others", async () => {
        fx.voice.channels.set("c1", ["u1", "u2", "u3"]);
        fx.voice.failing.add("u2");
        const service = fx.createService();

        const reply = await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue", "Green"]));

        expect(reply).toEqual({ ok: true, channelIds: ["c1"] });
        expect([...fx.voice.muted].sort()).toEqual(["u1", "u3"]);
        expect(await fx.ledgerIds()).toEqual(["u1", "u3"]);
        expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(GUILD));
        expect(logger.warn).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining("u2"));
        expect(logger.debug).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(new RegExp(`${GUILD}.*u2`)));

        fx.voice.failing.clear();
        fx.voice.failing.add("u1");
        await service.endSession(GUILD, "s1");
        expect([...fx.voice.muted]).toEqual(["u1"]);
        expect(await fx.ledgerIds()).toEqual(["u1"]);
    });

    it("tracks the active session", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        const service = fx.createService();
        expect(await fx.sessionIsActive(service)).toBe(false);

        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        expect(await fx.sessionIsActive(service)).toBe(true);
        expect(await fx.sessionIsActive(service, "s1", "other")).toBe(false);

        await service.handleGameEvent(gameEvent("lobby", ["Red"]));
        expect(await fx.sessionIsActive(service)).toBe(false);

        await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));
        expect(await fx.sessionIsActive(service)).toBe(true);
        await service.endSession(GUILD, "s1");
        expect(await fx.sessionIsActive(service)).toBe(false);
    });

    it("ignores endSession of a replaced session", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        const service = fx.createService();
        await service.handleGameEvent({ ...gameEvent("game-start", ["Red"]), sessionId: "s2" });

        await service.endSession(GUILD, "s1");

        expect(await fx.sessionIsActive(service, "s2")).toBe(true);
        expect([...fx.voice.muted]).toEqual(["u1"]);
    });

    it("returns an error reply and logs when the database is closed", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        const service = fx.createService();
        await fx.db.close();

        const reply = await service.handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(reply).toEqual({ ok: false, error: "mute update failed" });
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(GUILD), expect.anything());
        expect(fx.voice.calls).toEqual([]);
        fx.db = await createTestDatabase();
    });

    it("writes the ledger row before muting", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        const seen: string[][] = [];
        fx.voice.beforeSetMute = async (_id, mute) => {
            if (mute) seen.push(await fx.ledgerIds());
        };

        await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(seen).toEqual([["u1"]]);
    });

    it("a mute Discord rejected leaves no stale ledger row", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        fx.voice.failing.add("u1");

        await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(fx.voice.muted.size).toBe(0);
        expect(await fx.ledgerIds()).toEqual([]);
    });

    it("keeps the ledger row of a mute that timed out, so the release still lifts it", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        fx.voice.timeoutAfterApplying.add("u1");
        const service = fx.createService();

        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        expect([...fx.voice.muted]).toEqual(["u1"]);
        expect(await fx.ledgerIds()).toEqual(["u1"]);

        await service.endSession(GUILD, "s1");
        expect(fx.voice.muted.size).toBe(0);
        expect(await fx.ledgerIds()).toEqual([]);
    });

    it("keeps the ledger row of a mute that failed with a server error", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        fx.voice.failOnce.add("u1");

        await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(await fx.ledgerIds()).toEqual(["u1"]);
    });

    it("recover reads the ledger after earlier queued work", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        const service = fx.createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        fx.voice.afterSetMute = (id, mute) => {
            if (!mute) fx.voice.muted.add(id);
        };

        await Promise.all([service.handleGameEvent(gameEvent("lobby", [])), service.recover([GUILD])]);

        expect([...fx.voice.muted]).toEqual(["u1"]);
        expect(fx.voice.calls.filter((c) => !c.mute)).toHaveLength(1);
        expect(await fx.ledgerIds()).toEqual([]);
    });

    it("lobby and recover leave moderator mutes alone", async () => {
        fx.voice.channels.set("c1", ["u1", "u2"]);
        fx.voice.muted.add("u2");
        const service = fx.createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));

        await service.handleGameEvent(gameEvent("lobby", ["Red", "Blue"]));
        expect([...fx.voice.muted]).toEqual(["u2"]);

        await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
        await fx.createService().recover([GUILD]);
        expect([...fx.voice.muted]).toEqual(["u2"]);
        expect(fx.voice.calls.filter((c) => c.discordId === "u2")).toEqual([]);
    });

    it("a newer session takes over and a late endSession of the old session is ignored", async () => {
        fx.voice.channels.set("c1", ["u1"]);
        const service = fx.createService();
        await service.handleGameEvent(gameEvent("game-start", ["Red"]));
        await service.handleGameEvent({ ...gameEvent("meeting-end", ["Red"]), sessionId: "s2" });

        await service.endSession(GUILD, "s1");
        expect(await fx.sessionIsActive(service, "s2")).toBe(true);
        expect([...fx.voice.muted]).toEqual(["u1"]);
        expect(fx.voice.calls.filter((c) => !c.mute)).toEqual([]);

        await service.endSession(GUILD, "s2");
        expect(await fx.sessionIsActive(service, "s2")).toBe(false);
        expect(fx.voice.muted.size).toBe(0);
    });

    it("a failing channel does not stop the other channels", async () => {
        fx.target = { channelIds: ["bad", "c1"] };
        fx.voice.failingChannels.add("bad");
        fx.voice.channels.set("c1", ["u1"]);

        const reply = await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

        expect(reply).toEqual({ ok: true, channelIds: ["bad", "c1"] });
        expect([...fx.voice.muted]).toEqual(["u1"]);
        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("bad"), expect.any(Error));
    });
});
