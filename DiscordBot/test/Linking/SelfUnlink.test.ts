import { buildGuildCreateDispatch, DEFAULT_IDS, extractText } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../src/Commands/Command";
import type { Database } from "../../src/Data/Database";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { LINK_SELF_UNLINK_BUTTON_ID, unlinkSelf } from "../../src/Linking/SelfUnlink";
import { logger } from "../../src/Logging/Logger";
import { LinkingService } from "../../src/Utils/LinkingService";
import { createTestProbe } from "../Helpers/Probe";
import { createTestDatabase } from "../Helpers/TestDatabase";

const EPHEMERAL = 1 << 6;
const GUILD = DEFAULT_IDS.guild;
const USER = DEFAULT_IDS.user;

describe("unlinkSelf", () => {
    let db: Database;
    let probe: ReturnType<typeof createTestProbe>;
    let blockedUserIds: string[];

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        blockedUserIds = [];
        db = await createTestDatabase();
        await db.links.upsert(GUILD, USER, "Crew");

        const { Events } = await import("discord.js");
        const { createDiscordClient } = await import("../../src/Cluster/CreateDiscordClient");
        const { isComponentInteraction, registerComponent, routeComponent } = await import(
            "../../src/Cluster/ComponentRouter"
        );
        const ctx = {
            linking: new LinkingService(db),
            hosted: {
                blocks: new BlockChecker({
                    blocks: { isBlocked: async (type, id) => type === "user" && blockedUserIds.includes(id) },
                    hostedGuilds: { get: async () => null },
                }),
            },
        } as unknown as CommandContext;
        // Only the button handler is registered, so this exercises the refusal inside unlinkSelf without the interaction gate.
        registerComponent(LINK_SELF_UNLINK_BUTTON_ID, async (interaction, context) => {
            if (interaction.isButton()) await unlinkSelf(interaction, context);
        });
        const client = createDiscordClient();
        client.on(Events.InteractionCreate, async (interaction) => {
            if (isComponentInteraction(interaction)) await routeComponent(interaction, ctx);
        });
        probe = createTestProbe(client);
        await probe.setup();
        probe.injectDispatch(buildGuildCreateDispatch());
    });

    afterEach(async () => {
        await probe.teardown();
        await db.close();
        vi.restoreAllMocks();
    });

    const reply = () => probe.lastReply() ?? {};

    it("removes the link of a user who is not blocked", async () => {
        await probe.button(LINK_SELF_UNLINK_BUTTON_ID).click();

        await vi.waitFor(() => expect(probe.lastReply()).toBeDefined());
        expect(await db.links.get(GUILD, USER)).toBeNull();
    });

    it("refuses a blocked user and keeps the link", async () => {
        blockedUserIds.push(USER);

        await probe.button(LINK_SELF_UNLINK_BUTTON_ID).click();

        await vi.waitFor(() => expect(extractText(reply())).toContain("You are blocked from using this bot."));
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(await db.links.get(GUILD, USER)).toMatchObject({ accountName: "Crew" });
    });
});
