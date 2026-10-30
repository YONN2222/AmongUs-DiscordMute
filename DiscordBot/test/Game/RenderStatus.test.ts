import { describe, expect, it } from "vitest";
import { renderStatus } from "../../src/Game/RenderStatus";
import { FOOTER_TEXT } from "../../src/Utils/ContainerBuilder";
import { renderText } from "../Helpers/RenderText";

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
    it("lays out phase, code, players and footer", () => {
        const out = renderText(
            renderStatus({
                ...base,
                hostDiscordId: "1300000000000000009",
                players: [
                    { name: "Red", discordId: "1300000000000000001", dead: false },
                    { name: "Blue", discordId: null, dead: false },
                    { name: "Green", discordId: "1300000000000000002", dead: true },
                    { name: "Pink", discordId: null, dead: true },
                ],
            }),
        );
        expect(out).toBe(
            [
                "## In the lobby",
                "-# Among Us game status | Host: <@1300000000000000009>",
                "**Code:** ||ABCDEF||",
                "---",
                "**Players (4)**",
                "- **Red** <@1300000000000000001>",
                "- **Blue** *(not linked)*",
                "- ~~**Green**~~ <@1300000000000000002> *(dead)*",
                "- ~~**Pink**~~ *(not linked, dead)*",
                "---",
                FOOTER_TEXT,
            ].join("\n"),
        );
    });

    it("names the phase only once in german", () => {
        const out = renderText(renderStatus({ ...base, locale: "de" }));
        expect(out.split("\n").slice(0, 3)).toEqual([
            "## In der Lobby",
            "-# Among-Us-Spielstatus",
            "**Code:** ||ABCDEF||",
        ]);
        expect(out.match(/Lobby/g)).toHaveLength(1);
    });

    it("colors the accent by phase", () => {
        const accent = (phase: "lobby" | "tasks" | "meeting") =>
            (renderStatus({ ...base, phase })[0] as { accent_color: number }).accent_color;
        expect(new Set([accent("lobby"), accent("tasks"), accent("meeting")]).size).toBe(3);
    });

    it("shows the lobby code plain, as a spoiler or not at all", () => {
        expect(text({ ...base, lobbyCodeMode: "always" })).toContain("**Code:** ABCDEF");
        expect(text({ ...base, lobbyCodeMode: "spoiler" })).toContain("||ABCDEF||");
        expect(text({ ...base, lobbyCodeMode: "never" })).not.toContain("ABCDEF");
        expect(text({ ...base, lobbyCode: null, lobbyCodeMode: "always" })).not.toContain("Code:");
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
        expect(out).toContain("dead)");
        expect(out).toContain("Meeting");
    });

    it("renders in german", () => {
        const out = text({ ...base, locale: "de", players: [{ name: "Blue", discordId: null, dead: true }] });
        expect(out).toContain("nicht verkn");
        expect(out).toContain("*(nicht verknüpft, tot)*");
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
