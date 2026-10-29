import { DiscordAPIError } from "discord.js";
import type { MessagePort } from "../Cluster/MessagePort";
import type { TrackedMessageRepository } from "../Data/Repositories/TrackedMessageRepository";
import { logger, logModules } from "../Logging/Logger";

const SERVER_ERROR_STATUS = 500;
const RATE_LIMITED_STATUS = 429;

export interface SweeperDeps {
    port: Pick<MessagePort, "delete">;
    tracked: Pick<TrackedMessageRepository, "listDue" | "remove">;
}

/** A rejected delete that a retry cannot fix (message or channel gone, no access) must not keep the row alive. */
export function isFinalDeleteError(error: unknown): boolean {
    return (
        error instanceof DiscordAPIError && error.status < SERVER_ERROR_STATUS && error.status !== RATE_LIMITED_STATUS
    );
}

/** Deletes the tracked messages that are due. Best effort: a transient failure leaves the row for the next run. */
export async function sweepTrackedMessages(deps: SweeperDeps, guildIds: string[], now: number): Promise<void> {
    const due = await deps.tracked.listDue(guildIds, now);
    for (const row of due) {
        try {
            await deps.port.delete(row.channelId, row.messageId);
        } catch (error) {
            if (!isFinalDeleteError(error)) {
                logger.warn(logModules.Bot, `Guild ${row.guildId}: could not delete a ${row.kind} message, will retry`);
                continue;
            }
        }
        await deps.tracked.remove(row.guildId, row.kind, row.key);
    }
}
