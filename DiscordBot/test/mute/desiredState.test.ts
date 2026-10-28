import { describe, expect, it } from "vitest";
import type { LinkEntry } from "../../src/Data/repositories/LinkRepository";
import { computeDesiredState } from "../../src/Mute/desiredState";

function link(discordId: string, accountName: string): LinkEntry {
    return { guildId: "g1", discordId, accountName, linkedAt: "2026-01-01T00:00:00.000Z" };
}

const links = [link("u1", "Red"), link("u2", "Blue"), link("u3", "Green"), link("u4", "Lime")];

describe("computeDesiredState", () => {
    it("lobby unmutes everyone linked in the event", () => {
        const state = computeDesiredState({ event: "lobby", players: ["Red", "Blue"], deadPlayers: ["Green"], links });
        expect([...state.unmuted].sort()).toEqual(["u1", "u2", "u3"]);
        expect(state.muted.size).toBe(0);
    });

    it.each(["game-start", "meeting-end"] as const)("%s mutes alive and dead players", (event) => {
        const state = computeDesiredState({ event, players: ["Red", "Blue"], deadPlayers: ["Green"], links });
        expect([...state.muted].sort()).toEqual(["u1", "u2", "u3"]);
        expect(state.unmuted.size).toBe(0);
    });

    it("meeting-start unmutes alive and mutes dead", () => {
        const state = computeDesiredState({
            event: "meeting-start",
            players: ["Red", "Blue"],
            deadPlayers: ["Green"],
            links,
        });
        expect([...state.unmuted].sort()).toEqual(["u1", "u2"]);
        expect([...state.muted]).toEqual(["u3"]);
    });

    it("meeting-start keeps a player listed as alive and dead muted", () => {
        const state = computeDesiredState({ event: "meeting-start", players: ["Red"], deadPlayers: ["Red"], links });
        expect([...state.muted]).toEqual(["u1"]);
        expect(state.unmuted.size).toBe(0);
    });

    it("unlinked names map to nobody", () => {
        const state = computeDesiredState({ event: "game-start", players: ["Nobody"], deadPlayers: [], links });
        expect(state.muted.size).toBe(0);
        expect(state.ambiguousNames).toEqual([]);
    });

    it("ambiguous name maps to nobody", () => {
        const state = computeDesiredState({
            event: "game-start",
            players: ["Red", "Twin"],
            deadPlayers: [],
            links: [...links, link("u5", "Twin"), link("u6", " Twin ")],
        });
        expect([...state.muted]).toEqual(["u1"]);
        expect(state.ambiguousNames).toEqual(["Twin"]);
    });

    it("whitespace is trimmed", () => {
        const state = computeDesiredState({
            event: "game-start",
            players: ["  Red "],
            deadPlayers: [],
            links: [link("u1", " Red")],
        });
        expect([...state.muted]).toEqual(["u1"]);
    });

    it("matching is case-insensitive but not partial", () => {
        const state = computeDesiredState({ event: "game-start", players: ["rED", "Re"], deadPlayers: [], links });
        expect([...state.muted]).toEqual(["u1"]);
    });

    it("a stored 'X | name' matches name and the full stored value", () => {
        const piped = [link("u7", "Clan | Cyan"), link("u8", "Team | Pink")];
        const state = computeDesiredState({
            event: "game-start",
            players: ["cyan", "team | pink"],
            deadPlayers: [],
            links: piped,
        });
        expect([...state.muted].sort()).toEqual(["u7", "u8"]);
    });

    it("a pipe suffix colliding with another link is ambiguous", () => {
        const state = computeDesiredState({
            event: "game-start",
            players: ["Red"],
            deadPlayers: [],
            links: [link("u1", "Red"), link("u9", "Clan | red")],
        });
        expect(state.muted.size).toBe(0);
        expect(state.ambiguousNames).toEqual(["Red"]);
    });
});
