import type { Database } from "../Data/Database";
import { LEFT_GUILD_RETENTION_MS } from "../Data/Repositories/HostedGuildRepository";

const SYSTEM_ACTOR = "system";

type PurgeDeps = Pick<Database, "hostedGuilds" | "audit">;

/** When the data of a guild the bot left gets deleted; null while the bot is in it. */
export function purgeAtOf(leftAt: number | null): number | null {
    return leftAt === null ? null : leftAt + LEFT_GUILD_RETENTION_MS;
}

/** Deletes everything stored for the guild and audits who did it. */
export async function purgeGuildData(deps: PurgeDeps, guildId: string, actorId: string, now: number): Promise<void> {
    await deps.hostedGuilds.purgeGuild(guildId);
    await deps.audit.record({ actorId, action: "guild.purge", targetType: "guild", targetId: guildId }, now);
}

/** Deletes the data of every guild whose purge time has come; returns how many were deleted. */
export async function purgeLeftGuilds(deps: PurgeDeps, now: number): Promise<number> {
    const guildIds = await deps.hostedGuilds.listLeftBefore(now - LEFT_GUILD_RETENTION_MS);
    for (const guildId of guildIds) await purgeGuildData(deps, guildId, SYSTEM_ACTOR, now);
    return guildIds.length;
}
