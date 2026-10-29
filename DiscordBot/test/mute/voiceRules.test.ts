import { describe, expect, it } from "vitest";
import { delayFor, effectiveRules, phaseOf } from "../../src/Mute/voiceRules";
import { GAME_EVENT_NAMES } from "../../src/Protocol/PluginProtocol";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";

const settings = (patch: Partial<GuildSettings> = {}): GuildSettings => ({ ...DEFAULT_SETTINGS, ...patch });

describe("phaseOf", () => {
    it("maps every event to a phase", () => {
        expect(Object.fromEntries(GAME_EVENT_NAMES.map((event) => [event, phaseOf(event)]))).toEqual({
            lobby: "lobby",
            "game-start": "tasks",
            "meeting-start": "meeting",
            "meeting-end": "tasks",
            "player-died": "tasks",
        });
    });
});

describe("effectiveRules", () => {
    it("returns the configured rules without ghost chat", () => {
        expect(effectiveRules(settings())).toEqual(DEFAULT_SETTINGS.voiceRules);
    });

    it("lets ghost chat deafen the living and free the dead during tasks only", () => {
        const rules = effectiveRules(settings({ ghostChat: true }));

        expect(rules.tasks).toEqual({ alive: "deafen", dead: "free" });
        expect(rules.meeting).toEqual(DEFAULT_SETTINGS.voiceRules.meeting);
    });
});

describe("delayFor", () => {
    const delays = { gameStart: 100, meetingStart: 200, meetingEnd: 300, lobby: 1200 };
    const withDelays = settings({ delaysMs: delays });

    it("picks the delay of the event", () => {
        expect(delayFor("game-start", withDelays)).toBe(100);
        expect(delayFor("meeting-start", withDelays)).toBe(200);
        expect(delayFor("meeting-end", withDelays)).toBe(300);
        expect(delayFor("lobby", withDelays)).toBe(1200);
    });

    it("never delays a death", () => {
        expect(delayFor("player-died", withDelays)).toBe(0);
    });
});
