import { describe, expect, it } from "vitest";
import type { LinkEntry } from "../../src/Data/repositories/LinkRepository";
import { PAGE_SIZE, renderLinkOverview } from "../../src/LinkOverview/renderLinkOverview";

type Json = { type: number; custom_id?: string; disabled?: boolean; content?: string; components?: Json[] };

const GUILD = "1200000000000000001";

function entries(count: number, name = (i: number) => `Player${i}`): LinkEntry[] {
    return Array.from({ length: count }, (_, i) => ({
        guildId: GUILD,
        discordId: `13000000000000${String(i).padStart(4, "0")}`,
        accountName: name(i),
        linkedAt: "2026-01-01T00:00:00.000Z",
        friendCode: null,
    }));
}

function flatten(components: unknown[]): Json[] {
    const out: Json[] = [];
    const walk = (node: Json) => {
        out.push(node);
        for (const child of node.components ?? []) walk(child);
    };
    for (const component of components as Json[]) walk(component);
    return out;
}

const texts = (components: unknown[]) =>
    flatten(components)
        .filter((c) => typeof c.content === "string")
        .map((c) => c.content as string)
        .join("\n");
const ids = (components: unknown[]) => flatten(components).flatMap((c) => (c.custom_id ? [c.custom_id] : []));
const button = (components: unknown[], id: string) => flatten(components).find((c) => c.custom_id === id);

const base = { locale: "en", mode: "public", isAdmin: false } as const;

describe("renderLinkOverview", () => {
    it("escapes names and never pings", () => {
        const name = "`@everyone` **x**";
        const text = texts(renderLinkOverview({ ...base, entries: entries(1, () => name), total: 1, page: 0 }));

        expect(text).toContain("\\`@everyone\\` \\*\\*x\\*\\*");
        expect(text).not.toContain(name);
        expect(text).not.toMatch(/<@&|@here/);
    });

    it("keeps a typed mention in a name literal", () => {
        const text = texts(
            renderLinkOverview({ ...base, entries: entries(1, () => "<@123456789012345678>"), total: 1, page: 0 }),
        );

        expect(text).toContain("\\<@123456789012345678>");
    });

    it.each([0, 3, 20, 21])("always offers show more in the public view (%i links)", (total) => {
        const components = renderLinkOverview({ ...base, entries: entries(Math.min(total, 20)), total, page: 0 });

        expect(ids(components)).toEqual(["lo:link", "lo:unlink", "lo:more"]);
    });

    it("shows only the first page in the public view", () => {
        const text = texts(renderLinkOverview({ ...base, entries: entries(25), total: 25, page: 0 }));

        expect(text).toContain("Player19");
        expect(text).not.toContain("Player20");
    });

    it("navigates the ephemeral view with both buttons on a middle page", () => {
        const components = renderLinkOverview({
            ...base,
            mode: "ephemeral",
            entries: entries(20),
            total: 50,
            page: 1,
        });

        expect(texts(components)).toContain("Page 2 of 3");
        expect(button(components, "lo:page:0")?.disabled).toBeFalsy();
        expect(button(components, "lo:page:2")?.disabled).toBeFalsy();
        expect(ids(components)).not.toContain("lo:more");
    });

    it("disables the navigation at both ends", () => {
        const first = renderLinkOverview({ ...base, mode: "ephemeral", entries: entries(20), total: 50, page: 0 });
        const last = renderLinkOverview({ ...base, mode: "ephemeral", entries: entries(10), total: 50, page: 2 });

        expect(button(first, "lo:page:-1")?.disabled).toBe(true);
        expect(button(first, "lo:page:1")?.disabled).toBeFalsy();
        expect(button(last, "lo:page:3")?.disabled).toBe(true);
    });

    it("has no admin component unless the viewer is an admin in the private view", () => {
        const view = { ...base, entries: entries(3), total: 3, page: 0 } as const;

        expect(ids(renderLinkOverview({ ...view, mode: "ephemeral", isAdmin: false })).join()).not.toContain(
            "lo:admin-",
        );
        expect(ids(renderLinkOverview({ ...view, mode: "public", isAdmin: true })).join()).not.toContain("lo:admin-");
    });

    it("gives admins an unlink select for the page and a force button", () => {
        const components = renderLinkOverview({
            ...base,
            mode: "ephemeral",
            isAdmin: true,
            entries: entries(3, () => "x".repeat(150)),
            total: 3,
            page: 0,
        });

        const select = flatten(components).find((c) => c.custom_id === "lo:admin-unlink:0") as unknown as {
            options: { value: string; label: string }[];
        };
        expect(select.options.map((o) => o.value)).toEqual(entries(3).map((e) => e.discordId));
        expect(select.options.every((o) => o.label.length <= 100)).toBe(true);
        expect(ids(components)).toContain("lo:admin-force");
    });

    it("omits the select but keeps the force button on an empty page", () => {
        const components = renderLinkOverview({
            ...base,
            mode: "ephemeral",
            isAdmin: true,
            entries: [],
            total: 0,
            page: 0,
        });

        expect(ids(components)).toContain("lo:admin-force");
        expect(ids(components).join()).not.toContain("lo:admin-unlink");
    });

    it("shows the empty state", () => {
        expect(texts(renderLinkOverview({ ...base, entries: [], total: 0, page: 0 }))).toContain(
            "Nobody is linked yet",
        );
    });

    it("lists waiting members with the overflow count", () => {
        const text = texts(
            renderLinkOverview({
                ...base,
                entries: entries(1),
                total: 1,
                page: 0,
                pending: { discordIds: ["1400000000000000001", "1400000000000000002"], total: 12 },
            }),
        );

        expect(text).toContain("<@1400000000000000001>, <@1400000000000000002>");
        expect(text).toContain("and 10 more");
    });

    it("renders german text", () => {
        expect(texts(renderLinkOverview({ ...base, locale: "de", entries: [], total: 0, page: 0 }))).toContain(
            "Noch niemand",
        );
    });

    it("stays within the component and text limits for a full admin page of long names", () => {
        const components = renderLinkOverview({
            ...base,
            mode: "ephemeral",
            isAdmin: true,
            entries: entries(PAGE_SIZE, () => "*".repeat(64)),
            total: 100,
            page: 1,
            pending: {
                discordIds: Array.from({ length: 10 }, (_, i) => `14000000000000${String(i).padStart(4, "0")}`),
                total: 10,
            },
        });

        expect(flatten(components).length).toBeLessThanOrEqual(40);
        expect(texts(components).length).toBeLessThanOrEqual(4000);
    });
});
