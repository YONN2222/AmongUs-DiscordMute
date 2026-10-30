import { describe, expect, it, vi } from "vitest";
import { logger } from "../../src/Logging/Logger";
import { GUILD, gameEvent, useMuteServiceFixture } from "../Helpers/MuteServiceFixture";

describe("MuteService", () => {
    const fx = useMuteServiceFixture();

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

            expect(logger.error).toHaveBeenCalled();
            expect(await fx.ledgerIds()).toEqual(["u1"]);
        });
    });
});
