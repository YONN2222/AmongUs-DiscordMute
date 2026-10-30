import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/Settings/GuildSettings";
import { renderSetupPanel, SETUP_PAGES } from "../../src/Setup/RenderSetupPanel";

type Node = { type: number; custom_id?: string; content?: string; options?: { value: string; default?: boolean }[] };
type WithChildren = Node & { components?: WithChildren[]; default_values?: { id: string }[] };

const MAX_COMPONENTS = 40;
const CHANNEL = "1300000000000000123";

function flatten(components: unknown[]): WithChildren[] {
    return (components as WithChildren[]).flatMap((node) => [node, ...flatten(node.components ?? [])]);
}

const render = (page: (typeof SETUP_PAGES)[number], settings = DEFAULT_SETTINGS, locale: "en" | "de" = "en") =>
    flatten(renderSetupPanel(settings, page, locale, true));

const byId = (nodes: WithChildren[], id: string) => nodes.find((node) => node.custom_id === id);
const text = (nodes: WithChildren[]) => nodes.map((node) => node.content ?? "").join("\n");

describe("renderSetupPanel", () => {
    it.each(SETUP_PAGES)("keeps the %s page within the component limit and offers the page select", (page) => {
        const nodes = render(page);
        expect(nodes.length).toBeLessThanOrEqual(MAX_COMPONENTS);
        expect(byId(nodes, "setup:page")?.options?.find((option) => option.default)?.value).toBe(page);
    });

    it("shows the ghost chat warning and toggle on the voice page", () => {
        const nodes = render("voice");
        expect(text(nodes)).toContain("leaks information");
        expect(byId(nodes, "setup:ghostChat")).toBeDefined();
        expect(byId(nodes, "setup:delays")).toBeDefined();
        for (const id of ["tasks.alive", "tasks.dead", "meeting.alive", "meeting.dead"]) {
            expect(byId(nodes, `setup:voiceRules.${id}`)).toBeDefined();
        }
        expect(byId(nodes, "setup:nonPlayers")).toBeDefined();
    });

    it("preselects the stored values", () => {
        const settings = mergeSettings(DEFAULT_SETTINGS, {
            voiceRules: { meeting: { dead: "deafen" } },
            language: "de",
            logChannelId: CHANNEL,
            summary: { deleteAfterMinutes: 240 },
        });
        const chosen = (nodes: WithChildren[], id: string) =>
            byId(nodes, id)?.options?.find((option) => option.default)?.value;

        expect(chosen(render("voice", settings), "setup:voiceRules.meeting.dead")).toBe("deafen");
        expect(chosen(render("general", settings), "setup:language")).toBe("de");
        expect(byId(render("general", settings), "setup:logChannelId")?.default_values).toEqual([
            { id: CHANNEL, type: "channel" },
        ]);
        expect(chosen(render("game", settings), "setup:summary.deleteAfterMinutes")).toBe("240");
    });

    it("lets every channel select clear its value", () => {
        const channelSelects = [...render("general"), ...render("links"), ...render("game")].filter(
            (node) => node.custom_id && (node as { min_values?: number }).min_values === 0,
        );
        expect(channelSelects.map((node) => node.custom_id)).toEqual([
            "setup:logChannelId",
            "setup:linkOverview.channelId",
            "setup:status.channelId",
            "setup:summary.channelId",
        ]);
    });

    it("self-host panel has no secret button and no voice channel select", () => {
        const all = SETUP_PAGES.flatMap((page) => render(page));

        expect(byId(all, "setup:secret")).toBeUndefined();
        expect(byId(all, "setup:voiceChannelIds")).toBeUndefined();
        expect(text(all)).not.toContain("Plugin secret");
    });

    describe("in hosted mode", () => {
        const renderHosted = (
            page: (typeof SETUP_PAGES)[number],
            secretCreatedAt: number | null,
            settings = DEFAULT_SETTINGS,
        ) => flatten(renderSetupPanel(settings, page, "en", true, { secretCreatedAt }));

        it("hosted panel shows create when no secret exists", () => {
            const nodes = renderHosted("general", null);
            const button = byId(nodes, "setup:secret") as (Node & { label?: string }) | undefined;

            expect(text(nodes)).toContain("No plugin secret yet");
            expect(button?.label).toBe("Create secret");
        });

        it("hosted panel shows regenerate with the created time", () => {
            const createdAt = 1_700_000_000_000;
            const nodes = renderHosted("general", createdAt);
            const button = byId(nodes, "setup:secret") as (Node & { label?: string }) | undefined;

            expect(text(nodes)).toContain(`Plugin secret: created <t:${createdAt / 1000}:R>`);
            expect(button?.label).toBe("Generate new secret");
        });

        it("offers the voice channel select with the stored channels preselected", () => {
            const settings = mergeSettings(DEFAULT_SETTINGS, { voiceChannelIds: [CHANNEL] });
            const select = byId(renderHosted("voice", null, settings), "setup:voiceChannelIds") as
                | (WithChildren & {
                      min_values?: number;
                      max_values?: number;
                      channel_types?: number[];
                      placeholder?: string;
                  })
                | undefined;

            expect(select?.placeholder).toBe("No fallback channel - pick the voice channels you play in");
            expect(select?.min_values).toBe(0);
            expect(select?.max_values).toBe(10);
            expect(select?.channel_types).toEqual([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
            expect(select?.default_values).toEqual([{ id: CHANNEL, type: "channel" }]);
            expect(text(renderHosted("voice", null))).toContain("Fallback voice channels");
        });

        it.each(SETUP_PAGES)("keeps the %s page within the component limit", (page) => {
            expect(renderHosted(page, 1).length).toBeLessThanOrEqual(MAX_COMPONENTS);
        });
    });

    it("renders in german and contains no unicode symbols", () => {
        const all = SETUP_PAGES.map((page) => text(render(page, DEFAULT_SETTINGS, "de"))).join("\n");
        expect(all).toContain("Server-Einrichtung");
        expect(all).not.toMatch(/[←-⇿☀-➿\u{1F300}-\u{1FAFF}]/u);
    });
});
