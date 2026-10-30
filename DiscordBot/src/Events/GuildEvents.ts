import { logger, logModules } from "../Logging/Logger";
import type { GameEventName, RosterEntry } from "../Protocol/PluginProtocol";
import type { GuildSettings } from "../Settings/GuildSettings";

type GuildScoped<T> = T & { guildId: string };

export type GuildEvent = GuildScoped<
    | {
          type: "session-started";
          sessionId: string;
          pluginVersion: string;
          gameVersion: string;
          protocolVersion: number;
      }
    | { type: "session-ended"; sessionId: string }
    | {
          type: "game-event";
          sessionId: string;
          event: GameEventName;
          hostAccountName: string;
          players: string[];
          deadPlayers: string[];
          roster?: RosterEntry[];
          lobbyCode?: string;
          /** Empty when the mute update ended in a notice or failed. */
          channelIds: string[];
      }
    | { type: "game-ended"; sessionId: string; reason: string; winners: string[]; roster: RosterEntry[] }
    | {
          type: "link-changed";
          discordId: string;
          change: "linked" | "unlinked" | "force-linked" | "relinked";
          accountName?: string;
          previousName?: string;
          actorId?: string;
      }
    | { type: "pending-changed"; discordId: string }
    | { type: "settings-changed"; actorId: string; paths: string[]; before: GuildSettings; after: GuildSettings }
    | { type: "voice-error"; code: "missing-permission" | "member-not-editable"; discordId?: string }
    | { type: "secret-changed"; actorId: string; created: boolean }
>;

export type GuildEventHandler = (event: GuildEvent) => void | Promise<void>;

export type GuildEventSink = Pick<GuildEventBus, "emit">;

/** Fans guild events out to handlers without ever blocking or failing the code that emits them. */
export class GuildEventBus {
    private readonly handlers = new Set<GuildEventHandler>();

    on(handler: GuildEventHandler): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    emit(event: GuildEvent): void {
        for (const handler of [...this.handlers]) {
            Promise.resolve()
                .then(() => handler(event))
                .catch((error: unknown) => {
                    logger.error(logModules.Bot, `A ${event.type} handler failed in guild ${event.guildId}`, error);
                });
        }
    }
}
