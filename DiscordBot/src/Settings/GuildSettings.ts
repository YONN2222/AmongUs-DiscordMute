import { z } from "zod";

export type VoiceAction = "free" | "mute" | "deafen";

export interface GuildSettings {
    language: "en" | "de";
    logChannelId: string | null;
    linkOverview: { channelId: string | null; showPending: boolean };
    voiceRules: {
        tasks: { alive: VoiceAction; dead: VoiceAction };
        meeting: { alive: VoiceAction; dead: VoiceAction };
    };
    delaysMs: { gameStart: number; meetingStart: number; meetingEnd: number; lobby: number };
    ghostChat: boolean;
    nonPlayers: "ignore" | "mute" | "as-dead";
    autoRelink: boolean;
    nicknameSync: boolean;
    status: { channelId: string | null; lobbyCode: "always" | "spoiler" | "never" };
    summary: { channelId: string | null; deleteAfterMinutes: number };
    /** Hosted mode: voice channels used when the host is not in a voice channel. */
    voiceChannelIds: string[];
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SettingsPatch = DeepPartial<GuildSettings>;

const MAX_DELAY_MS = 5000;
const MAX_DELETE_AFTER_MINUTES = 1440;
export const MAX_VOICE_CHANNELS = 10;
const CHANNEL_ID_PATTERN = /^\d{17,20}$/;

const channelId = z.string().regex(CHANNEL_ID_PATTERN).nullable().catch(null);
const channelIds = z.array(z.string().regex(CHANNEL_ID_PATTERN)).max(MAX_VOICE_CHANNELS).catch([]);
const bool = (fallback: boolean) => z.boolean().catch(fallback);
const action = (fallback: VoiceAction) => z.enum(["free", "mute", "deafen"]).catch(fallback);
const clampedInt = (max: number) =>
    z
        .number()
        .transform((n) => Math.min(max, Math.max(0, Math.round(n))))
        .catch(0);

/** An object whose invalid or missing value falls back to the defaults of its fields. */
function section<T extends z.ZodRawShape>(shape: T) {
    const schema = z.object(shape);
    return schema.catch(() => schema.parse({}));
}

const settingsSchema = z.object({
    language: z.enum(["en", "de"]).catch("en"),
    logChannelId: channelId,
    linkOverview: section({ channelId, showPending: bool(false) }),
    voiceRules: section({
        tasks: section({ alive: action("mute"), dead: action("mute") }),
        meeting: section({ alive: action("free"), dead: action("mute") }),
    }),
    delaysMs: section({
        gameStart: clampedInt(MAX_DELAY_MS),
        meetingStart: clampedInt(MAX_DELAY_MS),
        meetingEnd: clampedInt(MAX_DELAY_MS),
        lobby: clampedInt(MAX_DELAY_MS),
    }),
    ghostChat: bool(false),
    nonPlayers: z.enum(["ignore", "mute", "as-dead"]).catch("ignore"),
    autoRelink: bool(true),
    nicknameSync: bool(false),
    status: section({ channelId, lobbyCode: z.enum(["always", "spoiler", "never"]).catch("spoiler") }),
    summary: section({ channelId, deleteAfterMinutes: clampedInt(MAX_DELETE_AFTER_MINUTES) }),
    voiceChannelIds: channelIds,
});

/** Never throws: every invalid or missing field falls back to its default. */
export function parseSettings(raw: unknown): GuildSettings {
    return settingsSchema.parse(isPlainObject(raw) ? raw : {}) as GuildSettings;
}

export const DEFAULT_SETTINGS: GuildSettings = parseSettings({});

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValues(base: unknown, patch: unknown): unknown {
    if (patch === undefined) return base;
    if (!isPlainObject(patch)) return patch;
    const baseObject = isPlainObject(base) ? base : {};
    const merged: Record<string, unknown> = { ...baseObject };
    for (const [key, value] of Object.entries(patch)) {
        merged[key] = mergeValues(baseObject[key], value);
    }
    return merged;
}

export function mergeSettings(base: GuildSettings, patch: SettingsPatch): GuildSettings {
    return parseSettings(mergeValues(base, patch));
}

function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => item === b[i]);
    return a === b;
}

function collectLeaves(value: unknown, prefix: string, out: Map<string, unknown>): Map<string, unknown> {
    if (isPlainObject(value)) {
        for (const [key, child] of Object.entries(value)) {
            collectLeaves(child, prefix === "" ? key : `${prefix}.${key}`, out);
        }
    } else {
        out.set(prefix, value);
    }
    return out;
}

/** Dot paths of every leaf whose value differs between the two settings. */
export function diffSettings(before: GuildSettings, after: GuildSettings): string[] {
    const beforeLeaves = collectLeaves(before, "", new Map());
    const afterLeaves = collectLeaves(after, "", new Map());
    return [...afterLeaves].filter(([path, value]) => !sameValue(beforeLeaves.get(path), value)).map(([path]) => path);
}
