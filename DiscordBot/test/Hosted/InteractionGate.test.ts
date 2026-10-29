import { buildGuildCreateDispatch, buildUser, DEFAULT_IDS, extractText } from "probe.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../src/Commands/Command";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { BlockedUserError } from "../../src/Utils/LinkingService";
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

    it("answers with the generic error and serves nothing when the block lookup fails", async () => {
        const failing = new BlockChecker({
            blocks: {
                isBlocked: async () => {
                    throw new Error("db down");
                },
            },
            hostedGuilds: { get: async () => null },
        });
        bot = await createCommandProbe({ hosted: { blocks: failing } });

        await bot.probe.slashCommand("link self").invoke();

        await vi.waitFor(() => expect(extractText(reply())).toContain("An error occurred"));
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(bot.pushLinkPending).not.toHaveBeenCalled();
    });

    it("force linking a blocked user replies with the blocked text and does not link", async () => {
        const target = "1300000000000000077";
        const linking = {
            forceLink: async () => {
                throw new BlockedUserError(target);
            },
        } as unknown as CommandContext["linking"];
        bot = await createCommandProbe({ linking });
        bot.probe.injectDispatch(buildGuildCreateDispatch());
        bot.probe.respond("GET", /\/guilds\/\d+\/members\/\d+$/, () => ({
            user: buildUser({ id: target, username: "target" }),
            roles: [],
            joined_at: "2024-01-01T00:00:00.000Z",
            deaf: false,
            mute: false,
            flags: 0,
        }));

        await bot.probe
            .modal("lo:force")
            .withFields({ user: target, name: "Red" })
            .withContext({ member: { permissions: "32" } })
            .submit();

        expect(extractText(reply())).toContain("blocked from using this bot");
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(await bot.db.links.get(DEFAULT_IDS.guild, target)).toBeNull();
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
