import { accountNameKeys, normalizeAccountName } from "../Data/accountNameMatch";
import type { LinkEntry } from "../Data/repositories/LinkRepository";
import type { GameEventName } from "../Protocol/PluginProtocol";
import type { GuildSettings, VoiceAction } from "../Settings/GuildSettings";
import { type Phase, phaseOf, type VoiceRules } from "./voiceRules";

export interface DesiredStateInput {
    event: GameEventName;
    players: string[];
    deadPlayers: string[];
    links: LinkEntry[];
    rules: VoiceRules;
    nonPlayers: GuildSettings["nonPlayers"];
}

export interface DesiredState {
    /** What every player that resolved to a linked member should get. */
    actions: Map<string, VoiceAction>;
    /** What members in the voice channel who are not in the game should get, or null to leave them alone. */
    nonPlayerAction: VoiceAction | null;
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

export function computeDesiredState({
    event,
    players,
    deadPlayers,
    links,
    rules,
    nonPlayers,
}: DesiredStateInput): DesiredState {
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
    const phase = phaseOf(event);

    const actions = new Map<string, VoiceAction>();
    if (phase === "lobby") {
        for (const id of [...alive, ...dead]) actions.set(id, "free");
    } else {
        // A player listed as alive and dead counts as dead.
        for (const id of alive) if (!dead.has(id)) actions.set(id, rules[phase].alive);
        for (const id of dead) actions.set(id, rules[phase].dead);
    }

    return { actions, nonPlayerAction: nonPlayerActionFor(phase, rules, nonPlayers), ambiguousNames: [...ambiguous] };
}

function nonPlayerActionFor(
    phase: Phase,
    rules: VoiceRules,
    nonPlayers: GuildSettings["nonPlayers"],
): VoiceAction | null {
    if (phase === "lobby" || nonPlayers === "ignore") return null;
    return nonPlayers === "mute" ? "mute" : rules[phase].dead;
}
