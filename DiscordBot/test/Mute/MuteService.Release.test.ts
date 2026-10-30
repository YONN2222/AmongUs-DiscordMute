import { describe, expect, it, vi } from "vitest";
import { logger } from "../../src/Logging/Logger";
import { GUILD, gameEvent, useMuteServiceFixture } from "../Helpers/MuteServiceFixture";

describe("MuteService", () => {
    const fx = useMuteServiceFixture();

    describe("before Discord confirmed the bot's own mute", () => {
        it("lifts the mute when the session ends right after it was set", async () => {
            fx.voice.channels.set("c1", ["u1"]);
            fx.voice.lagVoiceStateUpdates();
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            expect([...fx.voice.muted]).toEqual(["u1"]);

            await service.endSession(GUILD, "s1");

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("lifts the mute and the deafen when a meeting starts right after", async () => {
            fx.voice.channels.set("c1", ["u1"]);
            fx.settings = {
                ...fx.settings,
                voiceRules: { ...fx.settings.voiceRules, tasks: { alive: "deafen", dead: "mute" } },
            };
            fx.voice.lagVoiceStateUpdates();
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));

            expect(fx.voice.muted.size).toBe(0);
            expect(fx.voice.deafened.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });
    });

    describe("logging", () => {
        it("logs each phase and the session end with the number of changed members", async () => {
            fx.voice.channels.set("c1", ["u1", "u2"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red", "Blue"]));
            await service.endSession(GUILD, "s1");

            const lines = vi.mocked(logger.info).mock.calls.map((call) => call[1]);
            expect(lines).toEqual([
                `Guild ${GUILD}: game-start of session s1, mute calls 2, unmute calls 0`,
                `Guild ${GUILD}: session s1 ended, mute calls 0, unmute calls 2`,
            ]);
            const ids = vi.mocked(logger.debug).mock.calls.map((call) => call[1]);
            expect(ids).toContain(`Guild ${GUILD}: game-start of session s1, mute calls [u1, u2], unmute calls []`);
        });

        it("stays quiet for a sweep that changes nothing", async () => {
            await fx.db.muteLedger.set(GUILD, "u1", { muted: true, deafened: false }, null);
            await fx.createService().sweepIdle([GUILD]);
            expect(logger.info).not.toHaveBeenCalled();
        });
    });

    describe("sweepIdle", () => {
        it("retries an unmute that failed earlier", async () => {
            fx.voice.channels.set("c1", ["u1"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            fx.voice.failOnce.add("u1");
            await service.handleGameEvent(gameEvent("lobby", []));
            expect([...fx.voice.muted]).toEqual(["u1"]);
            expect(await fx.ledgerIds()).toEqual(["u1"]);

            await service.sweepIdle([GUILD, "other"]);

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("does nothing while a session is active", async () => {
            fx.voice.channels.set("c1", ["u1"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            fx.voice.calls.length = 0;

            await service.sweepIdle([GUILD]);

            expect([...fx.voice.muted]).toEqual(["u1"]);
            expect(fx.voice.calls).toEqual([]);
        });

        it("warns once and stops retrying a member the bot lacks permission for", async () => {
            await fx.db.muteLedger.set(GUILD, "u1", { muted: true, deafened: false }, null);
            fx.voice.channels.set("c1", ["u1"]);
            fx.voice.muted.add("u1");
            fx.voice.failing.add("u1");
            const service = fx.createService();

            await service.sweepIdle([GUILD]);
            await service.sweepIdle([GUILD]);

            expect(fx.voice.calls).toEqual([{ discordId: "u1", mute: false }]);
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(vi.mocked(logger.warn).mock.calls[0][1]).not.toContain("u1");
            expect(logger.error).not.toHaveBeenCalled();
            expect(await fx.ledgerIds()).toEqual(["u1"]);
        });

        it("lifts a member it lacked permission for once a voice change succeeds", async () => {
            await fx.db.muteLedger.set(GUILD, "u1", { muted: true, deafened: false }, null);
            fx.voice.channels.set("c1", ["u1"]);
            fx.voice.muted.add("u1");
            fx.voice.failing.add("u1");
            const service = fx.createService();
            await service.sweepIdle([GUILD]);

            fx.voice.failing.clear();
            await service.releaseIfIdle(GUILD, "u1");

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("asks the ledger once for all guilds", async () => {
            const listByGuilds = vi.spyOn(fx.db.muteLedger, "listByGuilds");
            const listByGuild = vi.spyOn(fx.db.muteLedger, "listByGuild");

            await fx.createService().sweepIdle([GUILD, "g2", "g3"]);

            expect(listByGuilds).toHaveBeenCalledTimes(1);
            expect(listByGuild).not.toHaveBeenCalled();
        });
    });

    describe("releaseIfIdle", () => {
        it("unmutes a ledger member who rejoins voice after the session ended", async () => {
            fx.voice.channels.set("c1", ["u1"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            fx.voice.leave("u1");
            await service.endSession(GUILD, "s1");
            expect(await fx.ledgerIds()).toEqual(["u1"]);

            fx.voice.channels.set("c2", ["u1"]);
            await service.releaseIfIdle(GUILD, "u1");

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("keeps the mute while a session is active", async () => {
            fx.voice.channels.set("c1", ["u1"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            await service.releaseIfIdle(GUILD, "u1");

            expect([...fx.voice.muted]).toEqual(["u1"]);
            expect(await fx.ledgerIds()).toEqual(["u1"]);
        });

        it("checks the ledger entry of the member only", async () => {
            await fx.db.muteLedger.set(GUILD, "u1", { muted: true, deafened: false }, null);
            fx.voice.channels.set("c1", ["u1"]);
            fx.voice.muted.add("u1");
            const listByGuild = vi.spyOn(fx.db.muteLedger, "listByGuild");

            await fx.createService().releaseIfIdle(GUILD, "u1");

            expect(listByGuild).not.toHaveBeenCalled();
            expect(fx.voice.muted.size).toBe(0);
        });

        it("leaves members outside the ledger alone", async () => {
            fx.voice.channels.set("c1", ["u2"]);
            fx.voice.muted.add("u2");

            await fx.createService().releaseIfIdle(GUILD, "u2");

            expect(fx.voice.calls).toEqual([]);
            expect([...fx.voice.muted]).toEqual(["u2"]);
        });

        it("logs instead of throwing when the unmute fails", async () => {
            await fx.db.muteLedger.set(GUILD, "u1", { muted: true, deafened: false }, null);
            fx.voice.channels.set("c1", ["u1"]);
            fx.voice.muted.add("u1");
            fx.voice.failing.add("u1");

            await expect(fx.createService().releaseIfIdle(GUILD, "u1")).resolves.toBeUndefined();

            expect(logger.warn).toHaveBeenCalled();
            expect(await fx.ledgerIds()).toEqual(["u1"]);
        });
    });
});
