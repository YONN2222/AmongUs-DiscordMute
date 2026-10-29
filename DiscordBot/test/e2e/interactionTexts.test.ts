import { buildButtonInteractionDispatch, buildSlashCommandInteractionDispatch, extractText } from "probe.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LINK_SELF_UNLINK_BUTTON_ID } from "../../src/Linking/selfUnlink";
import { type CommandProbe, createCommandProbe } from "../helpers/commandProbe";

describe("german replies", () => {
    let bot: CommandProbe;

    afterEach(async () => {
        await bot.close();
    });

    async function germanReplyTo(dispatch: { d: object }): Promise<string> {
        bot.inject(dispatch, "de");
        await vi.waitFor(() => expect(bot.probe.lastReply()).toBeDefined());
        return extractText(bot.probe.lastReply() ?? {});
    }

    it("/testconnection reports a connected plugin", async () => {
        bot = await createCommandProbe();
        const text = await germanReplyTo(buildSlashCommandInteractionDispatch("testconnection"));
        expect(text).toContain("Verbindung erfolgreich");
        expect(text).toContain("Das Among-Us-Plugin ist per WebSocket verbunden.");
    });

    it("/testconnection reports a missing plugin", async () => {
        bot = await createCommandProbe({ isPluginConnected: async () => false });
        const text = await germanReplyTo(buildSlashCommandInteractionDispatch("testconnection"));
        expect(text).toContain("Verbindung fehlgeschlagen");
        expect(text).toContain("Das Among-Us-Plugin ist nicht verbunden.");
    });

    it("the unlink button explains that nothing was linked", async () => {
        bot = await createCommandProbe();
        const text = await germanReplyTo(buildButtonInteractionDispatch(LINK_SELF_UNLINK_BUTTON_ID));
        expect(text).toContain("Nichts zu lösen");
        expect(text).toContain("Du warst gar nicht verknüpft.");
    });

    it("a failing command gets the generic error reply", async () => {
        bot = await createCommandProbe({
            isPluginConnected: async () => {
                throw new Error("boom");
            },
        });
        const text = await germanReplyTo(buildSlashCommandInteractionDispatch("testconnection"));
        expect(text).toContain("Fehler");
        expect(text).toContain("Es ist ein Fehler beim Ausführen dieses Befehls aufgetreten.");
    });
});
