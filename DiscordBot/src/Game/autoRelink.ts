import { matchesAccountName } from "../Data/accountNameMatch";
import type { LinkEntry, LinkRepository } from "../Data/repositories/LinkRepository";
import type { GuildEventBus } from "../Events/GuildEvents";
import type { RosterEntry } from "../Protocol/PluginProtocol";

export interface RelinkDeps {
    links: LinkRepository;
    events: Pick<GuildEventBus, "emit">;
}

function uniqueFriendCodes(roster: RosterEntry[]): Map<string, RosterEntry> {
    const seen = new Map<string, RosterEntry | null>();
    for (const entry of roster) {
        const code = entry.friendCode?.trim();
        if (!code) continue;
        seen.set(code, seen.has(code) ? null : entry);
    }
    return new Map([...seen].filter((pair): pair is [string, RosterEntry] => pair[1] !== null));
}

/**
 * Keeps links in step with the players of a game: a player whose name matches one link without a stored friend
 * code teaches that link its code, and a player who shows up under a new name but a known code renames the link.
 * Returns how many links were renamed.
 */
export async function relinkFromRoster(deps: RelinkDeps, guildId: string, roster: RosterEntry[]): Promise<number> {
    const entries = uniqueFriendCodes(roster);
    if (entries.size === 0) return 0;

    const links = await deps.links.listByGuild(guildId);
    let renamed = 0;
    for (const [friendCode, entry] of entries) {
        const byName = links.filter((link) => matchesAccountName(link.accountName, entry.name));
        if (byName.length > 1) continue;
        if (byName.length === 1) {
            await learnFriendCode(deps, guildId, byName[0], friendCode, links);
            continue;
        }
        const byCode = await deps.links.findByFriendCode(guildId, friendCode);
        if (byCode.length !== 1) continue;
        const [link] = byCode;
        await deps.links.rename(guildId, link.discordId, entry.name);
        deps.events.emit({
            type: "link-changed",
            guildId,
            discordId: link.discordId,
            change: "relinked",
            accountName: entry.name,
            previousName: link.accountName,
        });
        renamed++;
    }
    return renamed;
}

async function learnFriendCode(
    deps: RelinkDeps,
    guildId: string,
    link: LinkEntry,
    friendCode: string,
    links: LinkEntry[],
): Promise<void> {
    if (link.friendCode !== null) return;
    if (links.some((other) => other.friendCode === friendCode)) return;
    await deps.links.setFriendCode(guildId, link.discordId, friendCode);
}
