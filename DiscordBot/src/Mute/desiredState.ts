import { accountNameKeys, normalizeAccountName } from "../Data/accountNameMatch";
import type { LinkEntry } from "../Data/repositories/LinkRepository";
import type { GameEventName } from "../Protocol/PluginProtocol";

export interface DesiredStateInput {
    event: GameEventName;
    players: string[];
    deadPlayers: string[];
    links: LinkEntry[];
}

export interface DesiredState {
    muted: Set<string>;
    unmuted: Set<string>;
    ambiguousNames: string[];
}

function indexLinks(links: LinkEntry[]): Map<string, Set<string>> {
    const byKey = new Map<string, Set<string>>();
    for (const link of links) {
        for (const key of accountNameKeys(link.accountName)) {
            const ids = byKey.get(key) ?? new Set<string>();
            ids.add(link.discordId);
            byKey.set(key, ids);
        }
    }
    return byKey;
}

export function computeDesiredState({ event, players, deadPlayers, links }: DesiredStateInput): DesiredState {
    const byKey = indexLinks(links);
    const ambiguous = new Set<string>();

    const resolve = (names: string[]): Set<string> => {
        const ids = new Set<string>();
        for (const raw of names) {
            const name = raw.trim();
            const matches = byKey.get(normalizeAccountName(name));
            if (!matches) continue;
            if (matches.size > 1) {
                ambiguous.add(name);
                continue;
            }
            for (const id of matches) ids.add(id);
        }
        return ids;
    };

    const alive = resolve(players);
    const dead = resolve(deadPlayers);
    const everyone = new Set([...alive, ...dead]);

    let muted = new Set<string>();
    let unmuted = new Set<string>();
    if (event === "lobby") {
        unmuted = everyone;
    } else if (event === "meeting-start") {
        muted = dead;
        unmuted = new Set([...alive].filter((id) => !dead.has(id)));
    } else {
        muted = everyone;
    }

    return { muted, unmuted, ambiguousNames: [...ambiguous] };
}
