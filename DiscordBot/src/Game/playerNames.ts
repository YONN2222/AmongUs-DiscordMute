import { escapeMarkdown } from "discord.js";
import { accountNameKeys, normalizeAccountName } from "../Data/accountNameMatch";
import type { LinkEntry } from "../Data/repositories/LinkRepository";

/** An Among Us name made safe for a public message: markdown is escaped and a typed mention stays literal text. */
export function escapeName(name: string): string {
    return escapeMarkdown(name).replace(/</g, "\\<");
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
        if (!ids || ids.size !== 1) return null;
        return [...ids][0];
    };
}
