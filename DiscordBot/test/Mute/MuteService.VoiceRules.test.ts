import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";
import { GUILD, gameEvent, useMuteServiceFixture } from "../Helpers/MuteServiceFixture";

describe("MuteService", () => {
    const fx = useMuteServiceFixture();

    describe("voice rules", () => {
        const ghostChat = (): GuildSettings => ({ ...DEFAULT_SETTINGS, ghostChat: true });

        it("ghost chat deafens the living and frees the dead during tasks, and lifts both in the lobby", async () => {
            fx.settings = ghostChat();
            fx.voice.channels.set("c1", ["u1", "u2"]);
            const service = fx.createService();

            await service.handleGameEvent(gameEvent("game-start", ["Red"], ["Blue"]));

            expect(fx.voice.stateCalls).toEqual([{ discordId: "u1", patch: { mute: true, deaf: true } }]);
            expect(await fx.db.muteLedger.get(GUILD, "u1")).toMatchObject({ muted: true, deafened: true });
            expect(await fx.db.muteLedger.get(GUILD, "u2")).toBeNull();

            await service.handleGameEvent(gameEvent("lobby", []));

            expect(fx.voice.muted.size).toBe(0);
            expect(fx.voice.deafened.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("keeps a member deafened by a moderator deafened after the lobby", async () => {
            fx.settings = ghostChat();
            fx.voice.channels.set("c1", ["u1"]);
            fx.voice.deafened.add("u1");
            const service = fx.createService();

            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            expect(fx.voice.stateCalls).toEqual([{ discordId: "u1", patch: { mute: true } }]);
            expect(await fx.db.muteLedger.get(GUILD, "u1")).toMatchObject({ muted: true, deafened: false });

            await service.handleGameEvent(gameEvent("lobby", []));

            expect([...fx.voice.deafened]).toEqual(["u1"]);
            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("lifts only the deafen when the phase changes from deafen to mute", async () => {
            fx.settings = {
                ...DEFAULT_SETTINGS,
                voiceRules: { tasks: { alive: "deafen", dead: "mute" }, meeting: { alive: "mute", dead: "mute" } },
            };
            fx.voice.channels.set("c1", ["u1"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));
            fx.voice.stateCalls.length = 0;

            await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));

            expect(fx.voice.stateCalls).toEqual([{ discordId: "u1", patch: { deaf: false } }]);
            expect(await fx.db.muteLedger.get(GUILD, "u1")).toMatchObject({ muted: true, deafened: false });
        });

        it("mutes unlinked members while a game runs and frees them in the lobby", async () => {
            fx.settings = { ...DEFAULT_SETTINGS, nonPlayers: "mute" };
            fx.voice.channels.set("c1", ["u1", "u9", "bot1"]);
            fx.voice.bots.add("bot1");
            const service = fx.createService();

            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            expect([...fx.voice.muted].sort()).toEqual(["u1", "u9"]);
            expect(fx.voice.calls.some((c) => c.discordId === "bot1")).toBe(false);

            await service.handleGameEvent(gameEvent("lobby", []));

            expect(fx.voice.muted.size).toBe(0);
            expect(await fx.ledgerIds()).toEqual([]);
        });

        it("leaves unlinked members and bots alone by default", async () => {
            fx.voice.channels.set("c1", ["u1", "u9", "bot1"]);
            fx.voice.bots.add("bot1");

            await fx.createService().handleGameEvent(gameEvent("game-start", ["Red"]));

            expect([...fx.voice.muted]).toEqual(["u1"]);
        });

        it("treats non-players like the dead when asked to", async () => {
            fx.settings = {
                ...DEFAULT_SETTINGS,
                nonPlayers: "as-dead",
                voiceRules: { tasks: { alive: "mute", dead: "mute" }, meeting: { alive: "free", dead: "deafen" } },
            };
            fx.voice.channels.set("c1", ["u1", "u9"]);
            const service = fx.createService();
            await service.handleGameEvent(gameEvent("game-start", ["Red"]));

            await service.handleGameEvent(gameEvent("meeting-start", ["Red"]));

            expect([...fx.voice.deafened]).toEqual(["u9"]);
            expect([...fx.voice.muted].sort()).toEqual(["u9"]);
        });
    });
});
