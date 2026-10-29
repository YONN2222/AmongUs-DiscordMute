import { describe, expect, it } from "vitest";
import { renderStatus } from "../../src/Game/renderStatus";

const base = {
    phase: "lobby" as const,
    lobbyCode: "ABCDEF",
    lobbyCodeMode: "spoiler" as const,
    hostDiscordId: null,
    players: [{ name: "Red", discordId: "1300000000000000001", dead: false }],
    locale: "en" as const,
};

const text = (view: Parameters<typeof renderStatus>[0]) => JSON.stringify(renderStatus(view));

describe("renderStatus", () => {
    it("shows the lobby code plain, as a spoiler or not at all", () => {
        expect(text({ ...base, lobbyCodeMode: "always" })).toContain("Lobby code: ABCDEF");
        expect(text({ ...base, lobbyCodeMode: "spoiler" })).toContain("||ABCDEF||");
        expect(text({ ...base, lobbyCodeMode: "never" })).not.toContain("ABCDEF");
        expect(text({ ...base, lobbyCode: null, lobbyCodeMode: "always" })).not.toContain("Lobby code");
    });

    it("mentions linked players and marks unlinked and dead ones", () => {
        const out = text({
            ...base,
            phase: "meeting",
            hostDiscordId: "1300000000000000009",
            players: [
                { name: "Red", discordId: "1300000000000000001", dead: false },
                { name: "Blue", discordId: null, dead: true },
            ],
        });
        expect(out).toContain("<@1300000000000000001>");
        expect(out).toContain("<@1300000000000000009>");
        expect(out).toContain("not linked");
        expect(out).toContain("(dead)");
        expect(out).toContain("Meeting");
    });

    it("renders in german", () => {
        const out = text({ ...base, locale: "de", players: [{ name: "Blue", discordId: null, dead: true }] });
        expect(out).toContain("nicht verkn");
        expect(out).toContain("(tot)");
    });

    it("status renders hostile names literally", () => {
        const out = text({
            ...base,
            players: [{ name: "**@everyone** <@123> [x](http://e.vil)", discordId: null, dead: false }],
        });
        expect(out).toContain("\\\\*\\\\*@everyone\\\\*\\\\*");
        expect(out).toContain("\\\\<@123>");
        expect(out).not.toContain("**@everyone**");
    });

    it("keeps the message within the text limit for a full lobby", () => {
        const players = Array.from({ length: 128 }, (_, i) => ({
            name: `Player-${i}-${"x".repeat(50)}`,
            discordId: "1300000000000000001",
            dead: false,
        }));
        const components = renderStatus({ ...base, players }) as { components: { content?: string }[] }[];
        for (const part of components[0].components) {
            if (part.content) expect(part.content.length).toBeLessThanOrEqual(4000);
        }
    });
});
