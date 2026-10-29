import type { MessageKey } from "../i18n";
import type { GuildSettings, SettingsPatch, VoiceAction } from "../Settings/GuildSettings";
import type { SetupPage } from "./renderSetupPanel";

export const DELAY_FIELDS = ["gameStart", "meetingStart", "meetingEnd", "lobby"] as const;
export const DELETE_AFTER_MINUTES = [0, 5, 15, 30, 60, 240, 1440] as const;
export const VOICE_ACTIONS: readonly VoiceAction[] = ["free", "mute", "deafen"];
export const NON_PLAYER_MODES = ["ignore", "mute", "as-dead"] as const;
export const LOBBY_CODE_MODES = ["always", "spoiler", "never"] as const;
export const LANGUAGES = ["en", "de"] as const;

export const DELAYS_MODAL_FIELD = "delays-modal";
const MAX_DELAY_SECONDS = 5;
const CHANNEL_ID = /^\d{17,20}$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;

export type SetupResult = { patch: SettingsPatch } | { error: MessageKey };

const INVALID: SetupResult = { error: "setup.error.invalid" };

const CHANNEL_FIELDS = new Set(["logChannelId", "linkOverview.channelId", "status.channelId", "summary.channelId"]);
const TOGGLE_FIELDS = new Set(["linkOverview.showPending", "autoRelink", "ghostChat", "nicknameSync"]);
const VOICE_RULE_FIELD = /^voiceRules\.(tasks|meeting)\.(alive|dead)$/;

/** The page a setup field is shown on, so a change can redraw the page it came from. */
export function setupPageOf(field: string): SetupPage {
    if (field === "language" || field === "logChannelId") return "general";
    if (field.startsWith("linkOverview.") || field === "autoRelink") return "links";
    if (field.startsWith("voiceRules.") || field === "ghostChat" || field === "nonPlayers") return "voice";
    if (field === DELAYS_MODAL_FIELD) return "voice";
    return "game";
}

/** Builds `{ a: { b: value } }` from the path `a.b`. */
function patchAt(path: string, value: unknown): SettingsPatch {
    return path
        .split(".")
        .reverse()
        .reduce<unknown>((inner, key) => ({ [key]: inner }), value) as SettingsPatch;
}

function currentAt(settings: GuildSettings, path: string): unknown {
    return path
        .split(".")
        .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], settings);
}

function oneOf<T extends string | number>(allowed: readonly T[], raw: string | undefined): T | undefined {
    return allowed.find((value) => String(value) === raw);
}

function enumPatch<T extends string | number>(path: string, allowed: readonly T[], values: string[]): SetupResult {
    const value = oneOf(allowed, values[0]);
    return value === undefined || values.length !== 1 ? INVALID : { patch: patchAt(path, value) };
}

function togglePatch(path: string, values: string[], current: GuildSettings): SetupResult {
    if (values.length === 0) return { patch: patchAt(path, !currentAt(current, path)) };
    const state = oneOf(["true", "false"], values[0]);
    return state === undefined ? INVALID : { patch: patchAt(path, state === "true") };
}

function channelPatch(path: string, values: string[]): SetupResult {
    if (values.length === 0) return { patch: patchAt(path, null) };
    return values.length === 1 && CHANNEL_ID.test(values[0]) ? { patch: patchAt(path, values[0]) } : INVALID;
}

function parseDelaySeconds(text: string): number | null {
    const normalized = text.trim().replace(",", ".");
    if (!DECIMAL.test(normalized)) return null;
    const seconds = Number(normalized);
    return seconds > MAX_DELAY_SECONDS ? null : Math.round(seconds * 1000);
}

function delaysPatch(values: string[]): SetupResult {
    if (values.length !== DELAY_FIELDS.length) return INVALID;
    const parsed = values.map(parseDelaySeconds);
    if (parsed.some((ms) => ms === null)) return { error: "setup.error.delay" };
    const delaysMs = Object.fromEntries(DELAY_FIELDS.map((name, index) => [name, parsed[index]]));
    return { patch: { delaysMs } };
}

/**
 * Turns the raw input of one setup component into a settings patch.
 * Toggles flip the current value when no value is given, channel fields clear on no value.
 */
export function applySetupInput(field: string, values: string[], current: GuildSettings): SetupResult {
    if (CHANNEL_FIELDS.has(field)) return channelPatch(field, values);
    if (TOGGLE_FIELDS.has(field)) return togglePatch(field, values, current);
    if (VOICE_RULE_FIELD.test(field)) return enumPatch(field, VOICE_ACTIONS, values);
    switch (field) {
        case "language":
            return enumPatch(field, LANGUAGES, values);
        case "nonPlayers":
            return enumPatch(field, NON_PLAYER_MODES, values);
        case "status.lobbyCode":
            return enumPatch(field, LOBBY_CODE_MODES, values);
        case "summary.deleteAfterMinutes":
            return enumPatch(field, DELETE_AFTER_MINUTES, values);
        case DELAYS_MODAL_FIELD:
            return delaysPatch(values);
        default:
            return INVALID;
    }
}
