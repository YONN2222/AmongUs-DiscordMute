import { describe, expect, it } from "vitest";
import type { LinkEntry } from "../../src/Data/repositories/LinkRepository";
import { computeDesiredState } from "../../src/Mute/desiredState";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";

function link(discordId: string, accountName: string): LinkEntry {
    return { guildId: "g1", discordId, accountName, linkedAt: "2026-01-01T00:00:00.000Z" };
}

const links = [link("u1", "Red"), link("u2", "Blue"), link("u3", "Green"), link("u4", "Lime")];
const rules = DEFAULT_SETTINGS.voiceRules;
const base = { rules, nonPlayers: "ignore" as GuildSettings["nonPlayers"], links };

const actionsOf = (state: ReturnType<typeof computeDesiredState>) => Object.fromEntries(state.actions);

describe("computeDesiredState", () => {
    it("lobby frees everyone linked in the event", () => {
        const state = computeDesiredState({
            ...base,
            event: "lobby",
            players: ["Red", "Blue"],
            deadPlayers: ["Green"],
        });

        expect(actionsOf(state)).toEqual({ u1: "free", u2: "free", u3: "free" });
    });

    it.each(["game-start", "meeting-end", "player-died"] as const)("%s mutes alive and dead players", (event) => {
        const state = computeDesiredState({ ...base, event, players: ["Red", "Blue"], deadPlayers: ["Green"] });

        expect(actionsOf(state)).toEqual({ u1: "mute", u2: "mute", u3: "mute" });
    });

    it("meeting-start frees the living and mutes the dead", () => {
        const state = computeDesiredState({
            ...base,
            event: "meeting-start",
            players: ["Red", "Blue"],
            deadPlayers: ["Green"],
        });

        expect(actionsOf(state)).toEqual({ u1: "free", u2: "free", u3: "mute" });
    });

    it("meeting-start treats a player listed as alive and dead as dead", () => {
        const state = computeDesiredState({ ...base, event: "meeting-start", players: ["Red"], deadPlayers: ["Red"] });

        expect(actionsOf(state)).toEqual({ u1: "mute" });
    });

    it("applies the configured actions of the phase", () => {
        const custom = {
            tasks: { alive: "free", dead: "deafen" },
            meeting: { alive: "mute", dead: "deafen" },
        } as const;
        const input = { ...base, rules: custom, players: ["Red"], deadPlayers: ["Blue"] };

        expect(actionsOf(computeDesiredState({ ...input, event: "game-start" }))).toEqual({ u1: "free", u2: "deafen" });
        expect(actionsOf(computeDesiredState({ ...input, event: "meeting-start" }))).toEqual({
            u1: "mute",
            u2: "deafen",
        });
    });

    it("deafens the dead in a meeting when the rule says so", () => {
        const state = computeDesiredState({
            ...base,
            rules: { ...rules, meeting: { alive: "free", dead: "deafen" } },
            event: "meeting-start",
            players: ["Red"],
            deadPlayers: ["Green"],
        });

        expect(actionsOf(state)).toEqual({ u1: "free", u3: "deafen" });
    });

    describe("non-players", () => {
        const input = { ...base, event: "meeting-start" as const, players: ["Red"], deadPlayers: ["Green"] };

        it("leaves them alone by default", () => {
            expect(computeDesiredState(input).nonPlayerAction).toBeNull();
        });

        it("mutes them while a game runs and not in the lobby", () => {
            expect(computeDesiredState({ ...input, nonPlayers: "mute" }).nonPlayerAction).toBe("mute");
            expect(computeDesiredState({ ...input, event: "game-start", nonPlayers: "mute" }).nonPlayerAction).toBe(
                "mute",
            );
            expect(computeDesiredState({ ...input, event: "lobby", nonPlayers: "mute" }).nonPlayerAction).toBeNull();
        });

        it("treats them like the dead of the current phase", () => {
            const meeting = computeDesiredState({
                ...input,
                rules: { ...rules, meeting: { alive: "free", dead: "deafen" } },
                nonPlayers: "as-dead",
            });
            const tasks = computeDesiredState({ ...input, event: "game-start", nonPlayers: "as-dead" });

            expect(meeting.nonPlayerAction).toBe("deafen");
            expect(tasks.nonPlayerAction).toBe("mute");
        });
    });

    it("unlinked names map to nobody", () => {
        const state = computeDesiredState({ ...base, event: "game-start", players: ["Nobody"], deadPlayers: [] });

        expect(state.actions.size).toBe(0);
        expect(state.ambiguousNames).toEqual([]);
    });

    it("ambiguous name maps to nobody", () => {
        const state = computeDesiredState({
            ...base,
            event: "game-start",
            players: ["Red", "Twin"],
            deadPlayers: [],
            links: [...links, link("u5", "Twin"), link("u6", " Twin ")],
        });

        expect(actionsOf(state)).toEqual({ u1: "mute" });
        expect(state.ambiguousNames).toEqual(["Twin"]);
    });

    it("whitespace is trimmed", () => {
        const state = computeDesiredState({
            ...base,
            event: "game-start",
            players: ["  Red "],
            deadPlayers: [],
            links: [link("u1", " Red")],
        });

        expect(actionsOf(state)).toEqual({ u1: "mute" });
    });

    it("matching is case-insensitive but not partial", () => {
        const state = computeDesiredState({ ...base, event: "game-start", players: ["rED", "Re"], deadPlayers: [] });

        expect(actionsOf(state)).toEqual({ u1: "mute" });
    });

    it("a stored 'X | name' matches name and the full stored value", () => {
        const piped = [link("u7", "Clan | Cyan"), link("u8", "Team | Pink")];
        const state = computeDesiredState({
            ...base,
            event: "game-start",
            players: ["cyan", "team | pink"],
            deadPlayers: [],
            links: piped,
        });

        expect(actionsOf(state)).toEqual({ u7: "mute", u8: "mute" });
    });

    it("a pipe suffix colliding with another link is ambiguous", () => {
        const state = computeDesiredState({
            ...base,
            event: "game-start",
            players: ["Red"],
            deadPlayers: [],
            links: [link("u1", "Red"), link("u9", "Clan | red")],
        });

        expect(state.actions.size).toBe(0);
        expect(state.ambiguousNames).toEqual(["Red"]);
    });
});
