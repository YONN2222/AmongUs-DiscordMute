import { buildGuildCreateDispatch, buildSlashCommandInteractionDispatch, DEFAULT_IDS, extractText } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CommandProbe, createCommandProbe } from "../Helpers/CommandProbe";

const GUILD = DEFAULT_IDS.guild;
const EPHEMERAL = 1 << 6;
const UPDATE_MESSAGE = 7;
const admin = { member: { permissions: "32" } };

describe("/setup", () => {
    let bot: CommandProbe;

    beforeEach(async () => {
        bot = await createCommandProbe();
        bot.probe.injectDispatch(buildGuildCreateDispatch());
    });

    afterEach(async () => {
        await bot.close();
    });

    const reply = () => bot.probe.lastReply() ?? {};

    const lastUpdate = () => {
        const callbacks = bot.probe
            .capturedRequests()
            .filter((r) => /\/callback/.test(r.url) && (r.body as { type?: number })?.type === UPDATE_MESSAGE);
        return ((callbacks.at(-1)?.body as { data?: object })?.data ?? {}) as Parameters<typeof extractText>[0];
    };

    it("opens the general page privately for a member with Manage Server", async () => {
        await bot.probe.slashCommand("setup").withContext(admin).invoke();

        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(extractText(reply())).toContain("Log channel");
        expect(extractText(reply())).toContain("Among Us plugin: connected");
    });

    it("refuses members without Manage Server", async () => {
        await bot.probe.slashCommand("setup").invoke();

        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(extractText(reply())).toContain("Manage Server");
        expect(extractText(reply())).not.toContain("Log channel");
    });

    it("switches the page with the page select", async () => {
        await bot.probe.selectMenu("setup:page").withValues(["voice"]).withContext(admin).select();

        expect(extractText(lastUpdate())).toContain("leaks information");
    });

    it("saves a voice rule and redraws the page", async () => {
        await bot.probe.selectMenu("setup:voiceRules.meeting.dead").withValues(["deafen"]).withContext(admin).select();

        expect((await bot.db.settings.get(GUILD)).voiceRules.meeting.dead).toBe("deafen");
        expect(extractText(lastUpdate())).toContain("Dead players in meetings");
    });

    it("toggles a setting with its button", async () => {
        await bot.probe.button("setup:nicknameSync").withContext(admin).click();

        expect((await bot.db.settings.get(GUILD)).nicknameSync).toBe(true);
        expect(JSON.stringify(lastUpdate())).toContain("Nickname sync: On");
    });

    it("saves the delays from the modal", async () => {
        await bot.probe
            .modal("setup:delays-modal")
            .withFields({ gameStart: "1,5", meetingStart: "2", meetingEnd: "0", lobby: "0" })
            .withContext(admin)
            .submit();

        const { delaysMs } = await bot.db.settings.get(GUILD);
        expect(delaysMs).toEqual({ gameStart: 1500, meetingStart: 2000, meetingEnd: 0, lobby: 0 });
    });

    it("rejects a delay above 5 seconds and keeps the stored values", async () => {
        await bot.probe
            .modal("setup:delays-modal")
            .withFields({ gameStart: "9", meetingStart: "2", meetingEnd: "0", lobby: "0" })
            .withContext(admin)
            .submit();

        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(extractText(reply())).toContain("between 0 and 5");
        expect((await bot.db.settings.get(GUILD)).delaysMs.meetingStart).toBe(0);
    });

    it("opens the delays modal", async () => {
        await bot.probe.button("setup:delays").withContext(admin).click();

        expect(bot.probe.lastModal()).toMatchObject({ customId: "setup:delays-modal" });
    });

    it("does not change settings for members without Manage Server", async () => {
        await bot.probe.selectMenu("setup:voiceRules.meeting.dead").withValues(["deafen"]).select();

        expect(extractText(reply())).toContain("Manage Server");
        await vi.waitFor(async () => expect((await bot.db.settings.get(GUILD)).voiceRules.meeting.dead).toBe("mute"));
    });

    it("answers in the locale of the clicking user", async () => {
        bot.inject(buildSlashCommandInteractionDispatch("setup", admin), "de");

        await vi.waitFor(() => expect(bot.probe.lastReply()).toBeDefined());
        expect(extractText(reply())).toContain("Server-Einrichtung");
    });
});
