export type QuickChatCategory = "Impostor" | "Crew" | "Location" | "Meeting" | "Roles";

export interface QuickChatPhrase {
    id: number;
    label: string;
    category: QuickChatCategory;
}

export const QUICK_CHAT_CATALOG: QuickChatPhrase[] = [
    { id: 3142, label: "More Impostors", category: "Impostor" },
    { id: 3143, label: "Less Impostors", category: "Impostor" },
    { id: 3160, label: "More Impostor Vision", category: "Impostor" },
    { id: 3161, label: "Less Impostor Vision", category: "Impostor" },
    { id: 3162, label: "More Kill Cooldown", category: "Impostor" },
    { id: 3163, label: "Less Kill Cooldown", category: "Impostor" },
    { id: 3164, label: "Longer Kill Distance", category: "Impostor" },
    { id: 3165, label: "Shorter Kill Distance", category: "Impostor" },
    { id: 3175, label: "Shapeshifters", category: "Impostor" },
    { id: 3537, label: "Phantoms", category: "Impostor" },
    { id: 4067, label: "Vipers", category: "Impostor" },
    { id: 3154, label: "Faster Player Speed", category: "Crew" },
    { id: 3155, label: "Slower Player Speed", category: "Crew" },
    { id: 3158, label: "More Crewmate Vision", category: "Crew" },
    { id: 3159, label: "Less Crewmate Vision", category: "Crew" },
    { id: 3549, label: "Waiting for Players", category: "Crew" },
    { id: 3550, label: "Let's Wait for Players", category: "Crew" },
    { id: 2000, label: "Laptop", category: "Location" },
    { id: 2600, label: "Skeld", category: "Location" },
    { id: 2601, label: "Mira", category: "Location" },
    { id: 2602, label: "Polus", category: "Location" },
    { id: 2603, label: "Airship", category: "Location" },
    { id: 2604, label: "Fungle", category: "Location" },
    { id: 3144, label: "Confirm Ejects", category: "Meeting" },
    { id: 3145, label: "More Emergency Meetings", category: "Meeting" },
    { id: 3146, label: "Less Emergency Meetings", category: "Meeting" },
    { id: 3150, label: "More Discussion Time", category: "Meeting" },
    { id: 3151, label: "Less Discussion Time", category: "Meeting" },
    { id: 3152, label: "More Voting Time", category: "Meeting" },
    { id: 3153, label: "Less Voting Time", category: "Meeting" },
    { id: 3172, label: "Scientists", category: "Roles" },
    { id: 3173, label: "Guardian Angels", category: "Roles" },
    { id: 3174, label: "Engineers", category: "Roles" },
    { id: 3535, label: "Noisemakers", category: "Roles" },
    { id: 3536, label: "Trackers", category: "Roles" },
    { id: 4066, label: "Detectives", category: "Roles" },
    { id: 3176, label: "No Roles", category: "Roles" },
    { id: 3542, label: "Roles Galore Preset", category: "Roles" },
    { id: 1501, label: "Scientist", category: "Roles" },
    { id: 1503, label: "Guardian Angel", category: "Roles" },
    { id: 1502, label: "Engineer", category: "Roles" },
    { id: 1504, label: "Shapeshifter", category: "Roles" },
    { id: 1660, label: "Noisemaker", category: "Roles" },
    { id: 1671, label: "Phantom", category: "Roles" },
    { id: 1681, label: "Tracker", category: "Roles" },
    { id: 4037, label: "Viper", category: "Roles" },
    { id: 4000, label: "Detective", category: "Roles" },
    { id: 79, label: "Crewmate", category: "Roles" },
    { id: 80, label: "Impostor", category: "Roles" },
];
export function formatQuickChatCode(ids: number[]): string {
    return [...ids].sort((a, b) => a - b).join("-");
}

export function labelFor(id: number): string {
    return QUICK_CHAT_CATALOG.find((p) => p.id === id)?.label ?? `#${id}`;
}

export function categoryFor(id: number): QuickChatCategory | undefined {
    return QUICK_CHAT_CATALOG.find((p) => p.id === id)?.category;
}

export function describePhrase(id: number): string {
    const phrase = QUICK_CHAT_CATALOG.find((p) => p.id === id);
    return phrase ? `${phrase.label} (${phrase.category})` : `#${id}`;
}
export function pickQuickChatPhrases(count: number, exclude: ReadonlySet<string> = new Set()): QuickChatPhrase[] {
    const pool = [...QUICK_CHAT_CATALOG];
    const picked: QuickChatPhrase[] = [];

    while (picked.length < count && pool.length > 0) {
        const index = Math.floor(Math.random() * pool.length);
        const [phrase] = pool.splice(index, 1);
        picked.push(phrase);
    }

    const code = formatQuickChatCode(picked.map((p) => p.id));
    if (exclude.has(code) && pool.length + picked.length > count) {
        return pickQuickChatPhrases(count, exclude);
    }

    return picked;
}
