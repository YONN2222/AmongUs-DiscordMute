import { DEFAULT_IDS, extractText } from "probe.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { type CommandProbe, createCommandProbe } from "../Helpers/CommandProbe";

const EPHEMERAL = 1 << 6;
const BLOCKED_TEXT = "You are blocked from using this bot.";

const blocksOf = (blockedUserIds: string[]) =>
    new BlockChecker({
        blocks: { isBlocked: async (type, id) => type === "user" && blockedUserIds.includes(id) },
        hostedGuilds: { get: async () => null },
    });

describe("interaction gate", () => {
    let bot: CommandProbe;

    afterEach(async () => {
        await bot.close();
    });

    const reply = () => bot.probe.lastReply() ?? {};

    it("blocked user gets the blocked reply for commands and buttons", async () => {
        bot = await createCommandProbe({ hosted: { blocks: blocksOf([DEFAULT_IDS.user]) } });

        await bot.probe.slashCommand("link self").invoke();
        await vi.waitFor(() => expect(extractText(reply())).toContain(BLOCKED_TEXT));
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);

        await bot.probe.button("lo:more").click();
        await vi.waitFor(() =>
            expect(bot.probe.capturedRequests().filter((r) => /\/callback/.test(r.url))).toHaveLength(2),
        );
        expect(extractText(reply())).toContain(BLOCKED_TEXT);
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(bot.pushLinkPending).not.toHaveBeenCalled();
    });

    it("lets other users through", async () => {
        bot = await createCommandProbe({ hosted: { blocks: blocksOf(["someone-else"]) } });

        await bot.probe.slashCommand("link self").invoke();

        await vi.waitFor(() => expect(bot.pushLinkPending).toHaveBeenCalledTimes(1));
        expect(extractText(reply())).not.toContain(BLOCKED_TEXT);
    });

    it("no block lookup when hosted is not set", async () => {
        bot = await createCommandProbe();
        await bot.db.blocks.create({ type: "user", targetId: DEFAULT_IDS.user, reason: "test", blockedBy: "admin" });
        const lookup = vi.spyOn(bot.db.blocks, "isBlocked");

        await bot.probe.slashCommand("link self").invoke();

        await vi.waitFor(() => expect(bot.pushLinkPending).toHaveBeenCalledTimes(1));
        expect(lookup).not.toHaveBeenCalled();
    });
});
