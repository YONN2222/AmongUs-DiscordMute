import { vi } from "vitest";
import type { CommandContext, SecretCommandContext } from "../../src/Commands/Command";
import type { Database } from "../../src/Data/Database";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { LinkingService } from "../../src/Linking/LinkingService";
import { logger } from "../../src/Logging/Logger";
import { SettingsService } from "../../src/Settings/SettingsService";
import { createTestProbe } from "./Probe";
import { createTestDatabase } from "./TestDatabase";

export interface CommandProbe {
    db: Database;
    probe: ReturnType<typeof createTestProbe>;
    pushLinkPending: ReturnType<typeof vi.fn<CommandContext["pushLinkPending"]>>;
    /** Stands in for the gateway when /setup replaces a plugin secret. */
    disconnectGuild: ReturnType<typeof vi.fn<SecretCommandContext["disconnectGuild"]>>;
    /** Every guild event the commands and components emitted, in order. */
    events: GuildEvent[];
    /** Injects a prepared interaction dispatch with the given Discord locale. */
    inject(dispatch: { d: object }, discordLocale: string): void;
    close(): Promise<void>;
}

/** A bot client with the real interaction handlers, a SQLite database and a silenced logger. */
export async function createCommandProbe(
    overrides: Partial<CommandContext> | ((db: Database) => Partial<CommandContext>) = {},
): Promise<CommandProbe> {
    for (const level of ["info", "warn", "error", "debug", "success"] as const) {
        vi.spyOn(logger, level).mockImplementation(() => {});
    }
    // Imported once the logger is silenced, because loading the command registry logs.
    const { createDiscordClient } = await import("../../src/Cluster/CreateDiscordClient");
    const { registerInteractionHandlers } = await import("../../src/Cluster/InteractionHandler");
    const db = await createTestDatabase();
    const pushLinkPending = vi.fn<CommandContext["pushLinkPending"]>(async () => true);
    const disconnectGuild = vi.fn<SecretCommandContext["disconnectGuild"]>(async () => true);
    const client = createDiscordClient();
    const events: GuildEvent[] = [];
    const sink = { emit: (event: GuildEvent) => void events.push(event) };
    registerInteractionHandlers(client, {
        linking: new LinkingService(db, sink),
        events: sink,
        settings: new SettingsService(db.settings),
        pushLinkPending,
        isPluginConnected: async () => true,
        pluginSecret: { secrets: db.guildSecrets, disconnectGuild },
        ...(typeof overrides === "function" ? overrides(db) : overrides),
    });
    const probe = createTestProbe(client);
    await probe.setup();
    return {
        db,
        probe,
        pushLinkPending,
        disconnectGuild,
        events,
        inject(dispatch, discordLocale) {
            probe.injectDispatch({ ...dispatch, d: { ...dispatch.d, locale: discordLocale } } as never);
        },
        async close() {
            await probe.teardown();
            await db.close();
            vi.restoreAllMocks();
        },
    };
}
