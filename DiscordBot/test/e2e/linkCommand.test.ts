import { extractText } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../src/commands/Command";
import type { Database } from "../../src/Data/database";
import { logger } from "../../src/Logging/logger";
import { LinkingService } from "../../src/Utils/LinkingService";
import { createTestProbe } from "../helpers/probe";
import { createTestDatabase } from "../helpers/testDatabase";

const EPHEMERAL = 1 << 6;

describe("/link self", () => {
    let db: Database;
    let probe: ReturnType<typeof createTestProbe>;
    let pushLinkPending: ReturnType<typeof vi.fn<CommandContext["pushLinkPending"]>>;

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        // Imported once the logger is silenced, because loading the command registry logs.
        const { createDiscordClient } = await import("../../src/Cluster/createDiscordClient");
        const { registerInteractionHandlers } = await import("../../src/Cluster/interactionHandler");
        db = await createTestDatabase();
        pushLinkPending = vi.fn<CommandContext["pushLinkPending"]>(async () => true);
        const client = createDiscordClient();
        registerInteractionHandlers(client, {
            linking: new LinkingService(db),
            pushLinkPending,
            isPluginConnected: async () => true,
        });
        probe = createTestProbe(client);
        await probe.setup();
    });

    afterEach(async () => {
        await probe.teardown();
        await db.close();
        vi.restoreAllMocks();
    });

    it("replies ephemerally with the code it pushed to the plugin", async () => {
        await probe.slashCommand("link self").invoke();

        await vi.waitFor(() => expect(probe.lastReply()).toBeDefined());
        const reply = probe.lastReply() ?? {};
        expect(pushLinkPending).toHaveBeenCalledTimes(1);
        const [, phrase] = pushLinkPending.mock.calls[0];
        expect(extractText(reply)).toContain(phrase);
        expect(Number(reply.flags) & EPHEMERAL).toBe(EPHEMERAL);
    });
});
