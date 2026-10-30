import { buildGuildCreateDispatch, buildUser, DEFAULT_IDS, extractText } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CommandProbe, createCommandProbe } from "../Helpers/CommandProbe";

const GUILD = DEFAULT_IDS.guild;
const EPHEMERAL = 1 << 6;
const UPDATE_MESSAGE = 7;
const MANAGE_GUILD = "32";
const MEMBER_ROUTE = /\/guilds\/\d+\/members\/\d+$/;
const TARGET = "1300000000000000077";
const linkedId = (index: number) => `13000000000000${String(index).padStart(2, "0")}00`;
const FIRST_LINKED = linkedId(0);

const admin = { member: { permissions: MANAGE_GUILD } };

function guildMember(id: string) {
    return {
        user: buildUser({ id, username: `user-${id.slice(-2)}` }),
        roles: [],
        joined_at: "2024-01-01T00:00:00.000Z",
        deaf: false,
        mute: false,
        flags: 0,
    };
}

describe("link overview buttons", () => {
    let bot: CommandProbe;

    beforeEach(async () => {
        bot = await createCommandProbe();
        bot.probe.injectDispatch(buildGuildCreateDispatch());
        for (let i = 0; i < 25; i++) {
            await bot.db.links.upsert(GUILD, linkedId(i), `Player${String(i).padStart(2, "0")}`);
        }
    });

    afterEach(async () => {
        await bot.close();
    });

    const reply = () => bot.probe.lastReply() ?? {};

    /** probe.ts does not count a component update as a reply, so it is read from the captured callback. */
    const lastUpdate = () => {
        const callbacks = bot.probe
            .capturedRequests()
            .filter((r) => /\/callback/.test(r.url) && (r.body as { type?: number })?.type === UPDATE_MESSAGE);
        return ((callbacks.at(-1)?.body as { data?: object })?.data ?? {}) as Parameters<typeof extractText>[0];
    };

    it("show more sends the first page privately", async () => {
        await bot.probe.button("lo:more").click();

        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(extractText(reply())).toContain("Page 1 of 2");
        expect(extractText(reply())).toContain("Player00");
    });

    it("the page buttons update the same private message", async () => {
        await bot.probe.button("lo:page:1").click();

        expect(extractText(lastUpdate())).toContain("Page 2 of 2");
        expect(extractText(lastUpdate())).toContain("Player24");
        expect(extractText(lastUpdate())).not.toContain("Player00");
    });

    it("clamps a page far outside the range", async () => {
        await bot.probe.button("lo:page:99").click();

        expect(extractText(lastUpdate())).toContain("Page 2 of 2");
    });

    it("refuses the admin controls to members without Manage Server", async () => {
        await bot.probe.button("lo:admin-force").click();

        expect(extractText(reply())).toContain("Manage Server");
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(bot.probe.lastModal()).toBeUndefined();
    });

    it("opens the force link modal for admins", async () => {
        await bot.probe.button("lo:admin-force").withContext(admin).click();

        expect(bot.probe.lastModal()).toMatchObject({ customId: "lo:force" });
    });

    it("force links the member named in the modal with a trimmed name", async () => {
        bot.probe.respond("GET", MEMBER_ROUTE, () => guildMember(TARGET));

        await bot.probe
            .modal("lo:force")
            .withFields({ user: `<@${TARGET}>`, name: "  Red  " })
            .withContext(admin)
            .submit();

        expect((await bot.db.links.get(GUILD, TARGET))?.accountName).toBe("Red");
        expect(extractText(reply())).toContain("Red");
        expect(bot.events).toContainEqual(
            expect.objectContaining({
                type: "link-changed",
                change: "force-linked",
                discordId: TARGET,
                actorId: DEFAULT_IDS.user,
            }),
        );
    });

    it("escapes the name in the force link reply", async () => {
        bot.probe.respond("GET", MEMBER_ROUTE, () => guildMember(TARGET));

        await bot.probe.modal("lo:force").withFields({ user: TARGET, name: "**Red**" }).withContext(admin).submit();

        expect(extractText(reply())).toContain("\\*\\*Red\\*\\*");
    });

    it("rejects an unknown user and an empty name without linking", async () => {
        bot.probe.respond("GET", MEMBER_ROUTE, () => {
            throw new Error("not found");
        });
        await bot.probe.modal("lo:force").withFields({ user: TARGET, name: "Red" }).withContext(admin).submit();
        expect(extractText(reply())).toContain("could not be found");

        await bot.probe.modal("lo:force").withFields({ user: TARGET, name: "   " }).withContext(admin).submit();
        expect(extractText(reply())).toContain("between 1 and 64");
        expect(await bot.db.links.get(GUILD, TARGET)).toBeNull();
    });

    it("does not force link for members without Manage Server", async () => {
        bot.probe.respond("GET", MEMBER_ROUTE, () => guildMember(TARGET));

        await bot.probe.modal("lo:force").withFields({ user: TARGET, name: "Red" }).submit();

        expect(extractText(reply())).toContain("Manage Server");
        expect(await bot.db.links.get(GUILD, TARGET)).toBeNull();
    });

    it("admin unlink removes the chosen member and refreshes the view", async () => {
        await bot.probe.selectMenu("lo:admin-unlink:0").withValues([FIRST_LINKED]).withContext(admin).select();

        expect(await bot.db.links.get(GUILD, FIRST_LINKED)).toBeNull();
        expect(extractText(lastUpdate())).toContain("24 linked");
        expect(bot.events).toContainEqual(
            expect.objectContaining({ type: "link-changed", change: "unlinked", actorId: DEFAULT_IDS.user }),
        );
    });

    it("link gives the same private codes as /link self and announces the pending link", async () => {
        await bot.probe.button("lo:link").click();

        expect(bot.pushLinkPending).toHaveBeenCalledTimes(1);
        const [, phrase] = bot.pushLinkPending.mock.calls[0];
        expect(extractText(reply())).toContain(phrase);
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(bot.events).toContainEqual({ type: "pending-changed", guildId: GUILD, discordId: DEFAULT_IDS.user });
    });

    it("unlink removes the clicking member's own link", async () => {
        await bot.db.links.upsert(GUILD, DEFAULT_IDS.user, "Me");

        await bot.probe.button("lo:unlink").click();

        await vi.waitFor(async () => expect(await bot.db.links.get(GUILD, DEFAULT_IDS.user)).toBeNull());
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(bot.events).toContainEqual(
            expect.objectContaining({ type: "link-changed", change: "unlinked", discordId: DEFAULT_IDS.user }),
        );
    });
});
