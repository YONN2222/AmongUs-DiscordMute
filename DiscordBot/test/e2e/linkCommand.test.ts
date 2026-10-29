import { buildSlashCommandInteractionDispatch, extractText } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CommandProbe, createCommandProbe } from "../helpers/commandProbe";

const EPHEMERAL = 1 << 6;

describe("/link self", () => {
    let bot: CommandProbe;

    beforeEach(async () => {
        bot = await createCommandProbe();
    });

    afterEach(async () => {
        await bot.close();
    });

    async function linkSelfAs(discordLocale: string) {
        bot.inject(buildSlashCommandInteractionDispatch("link self"), discordLocale);
        await vi.waitFor(() => expect(bot.probe.lastReply()).toBeDefined());
        const [guildId, phrase, , discordId] = bot.pushLinkPending.mock.calls[0];
        return { guildId, phrase, discordId, text: extractText(bot.probe.lastReply() ?? {}) };
    }

    const storedLocale = (guildId: string, discordId: string) =>
        bot.db.pendingLinks.getActive(guildId, discordId, Date.now()).then((pending) => pending?.locale);

    it("replies ephemerally with the code it pushed to the plugin", async () => {
        await bot.probe.slashCommand("link self").invoke();

        await vi.waitFor(() => expect(bot.probe.lastReply()).toBeDefined());
        const reply = bot.probe.lastReply() ?? {};
        expect(bot.pushLinkPending).toHaveBeenCalledTimes(1);
        const [, phrase] = bot.pushLinkPending.mock.calls[0];
        expect(extractText(reply)).toContain(phrase);
        expect(Number(reply.flags) & EPHEMERAL).toBe(EPHEMERAL);
    });

    it("replies in german to an interaction with locale de and remembers it", async () => {
        const { guildId, phrase, discordId, text } = await linkSelfAs("de");

        expect(text).toContain("Öffne in einer Among-Us-Lobby den **Freien Chat**");
        expect(text).toContain(phrase);
        await vi.waitFor(async () => expect(await storedLocale(guildId, discordId)).toBe("de"));
    });

    it("replies in english to an interaction with locale en-US and remembers it", async () => {
        const { guildId, discordId, text } = await linkSelfAs("en-US");

        expect(text).toContain("Open **Free Chat** in Among Us while in a lobby");
        await vi.waitFor(async () => expect(await storedLocale(guildId, discordId)).toBe("en"));
    });
});
