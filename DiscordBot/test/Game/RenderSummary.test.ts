import { describe, expect, it } from "vitest";
import { describeGameOverReason } from "../../src/Game/GameOverReason";
import { renderSummary } from "../../src/Game/RenderSummary";
import { de } from "../../src/I18n/De";
import { en } from "../../src/I18n/En";
import { FOOTER_TEXT } from "../../src/Utils/ContainerBuilder";
import { renderText } from "../Helpers/RenderText";

const RED_ID = "1300000000000000001";

const base = {
    reason: "HumansByTask",
    winners: ["Red"],
    players: [
        { name: "Red", discordId: RED_ID, dead: false },
        { name: "Blue", discordId: null, dead: true },
    ],
    durationMs: 754_000,
    locale: "en" as const,
};

const text = (view: Parameters<typeof renderSummary>[0]) => JSON.stringify(renderSummary(view));

describe("describeGameOverReason", () => {
    it("localizes the vanilla reasons", () => {
        expect(describeGameOverReason("HumansByTask", "en")).toBe(en["gameOver.HumansByTask"]);
        expect(describeGameOverReason("HumansByTask", "de")).toBe(de["gameOver.HumansByTask"]);
        expect(describeGameOverReason("HumansByTask", "en")).not.toBe(describeGameOverReason("HumansByTask", "de"));
    });

    it("covers every vanilla reason", () => {
        for (const reason of [
            "HumansByVote",
            "HumansByTask",
            "ImpostorByVote",
            "ImpostorByKill",
            "ImpostorBySabotage",
            "ImpostorDisconnect",
            "HumansDisconnect",
            "HideAndSeek_ImpostorsByKills",
            "HideAndSeek_CrewmatesByTimer",
        ]) {
            expect(describeGameOverReason(reason, "en")).toBe(en[`gameOver.${reason}` as keyof typeof en]);
        }
    });

    it("shows other values as the escaped raw string", () => {
        expect(describeGameOverReason("137", "en")).toBe("137");
        expect(describeGameOverReason("Mod_*Win*", "de")).toBe("Mod\\_\\*Win\\*");
        expect(describeGameOverReason("constructor", "en")).toBe("constructor");
    });
});

describe("renderSummary", () => {
    it("lays out result, winners, duration, players and footer", () => {
        expect(renderText(renderSummary(base))).toBe(
            [
                "## Match summary",
                `**${en["gameOver.HumansByTask"]}**`,
                `**Winners:** <@${RED_ID}>`,
                "**Duration:** 12:34",
                "---",
                "**Players (2)**",
                `- **Red** <@${RED_ID}>`,
                "- ~~**Blue**~~ *(not linked, dead)*",
                "---",
                FOOTER_TEXT,
            ].join("\n"),
        );
    });

    it("shows winners with a mention when linked and the duration as minutes and seconds", () => {
        const out = text(base);
        expect(out).toContain(`<@${RED_ID}>`);
        expect(out).toContain("**Duration:** 12:34");
        expect(out).toContain(en["gameOver.HumansByTask"]);
    });

    it("matches winners to the roster despite a prefixed roster name", () => {
        const out = text({
            ...base,
            winners: ["Red"],
            players: [{ name: "Host | Red", discordId: RED_ID, dead: false }],
        });
        expect(out).toContain(`**Winners:** <@${RED_ID}>`);
    });

    it("prefers explicit winner ids and escapes unlinked winners", () => {
        const out = text({ ...base, winners: ["Ghost", "**Bold**"], winnerDiscordIds: [RED_ID, null] });
        expect(out).toContain(`<@${RED_ID}>, \\\\*\\\\*Bold\\\\*\\\\*`);
    });

    it("omits the duration when unknown and formats hours", () => {
        expect(text({ ...base, durationMs: null })).not.toContain("Duration");
        expect(text({ ...base, durationMs: 3_725_000 })).toContain("1:02:05");
    });

    it("renders in german and marks dead players", () => {
        const out = text({ ...base, locale: "de" });
        expect(out).toContain("**Gewinner:**");
        expect(out).toContain("*(nicht verknüpft, tot)*");
    });

    it("shows none for a game without winners", () => {
        expect(text({ ...base, winners: [] })).toContain("**Winners:** none");
    });
});
