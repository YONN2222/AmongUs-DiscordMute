import { escapeMarkdown } from "discord.js";
import { accountNameKeys, normalizeAccountName } from "../Data/AccountNameMatch";
import type { LinkEntry } from "../Data/Repositories/LinkRepository";
import { type Locale, t } from "../I18n/Index";

export interface ListedPlayer {
    name: string;
    discordId: string | null;
    dead: boolean;
}

/** An Among Us name made safe for a public message: markdown is escaped and a typed mention stays literal text. */
export function escapeName(name: string): string {
    return escapeMarkdown(name).replace(/</g, "\\<");
}

/**
 * One player bullet: the bold name, struck through when dead, then the Discord mention when linked and a short
 * italic note for what is missing or dead, e.g. "- ~~**Pink**~~ *(not linked, dead)*".
 */
function playerLine(player: ListedPlayer, locale: Locale): string {
    const name = `**${escapeName(player.name)}**`;
    const parts = [player.dead ? `~~${name}~~` : name];
    if (player.discordId) parts.push(`<@${player.discordId}>`);
    const notes: string[] = [];
    if (!player.discordId) notes.push(t(locale, "status.notLinked"));
    if (player.dead) notes.push(t(locale, "status.dead"));
    if (notes.length > 0) parts.push(`*(${notes.join(", ")})*`);
    return `- ${parts.join(" ")}`;
}

/** One bullet per player, cut off with an "and N more" line at maxLength. */
export function playerListText(players: ListedPlayer[], locale: Locale, maxLength: number): string {
    const lines: string[] = [];
    let length = 0;
    for (const player of players) {
        const line = playerLine(player, locale);
        if (length + line.length + 1 > maxLength) break;
        lines.push(line);
        length += line.length + 1;
    }
    const hidden = players.length - lines.length;
    if (hidden > 0) lines.push(t(locale, "log.more", { count: hidden }));
    return lines.join("\n");
}

/** Finds the linked Discord user of an Among Us name; a name that matches several links resolves to nobody. */
export function createNameResolver(links: LinkEntry[]): (name: string) => string | null {
    const byKey = new Map<string, Set<string>>();
    for (const link of links) {
        for (const key of accountNameKeys(link.accountName)) {
            const ids = byKey.get(key) ?? new Set<string>();
            ids.add(link.discordId);
            byKey.set(key, ids);
        }
    }
    return (name) => {
        const ids = byKey.get(normalizeAccountName(name));
        if (ids?.size !== 1) return null;
        return [...ids][0];
    };
}
