import { type Locale, type MessageKey, t } from "../I18n/Index";
import { escapeName } from "./PlayerNames";

const VANILLA_REASONS: Record<string, MessageKey> = {
    HumansByVote: "gameOver.HumansByVote",
    HumansByTask: "gameOver.HumansByTask",
    ImpostorByVote: "gameOver.ImpostorByVote",
    ImpostorByKill: "gameOver.ImpostorByKill",
    ImpostorBySabotage: "gameOver.ImpostorBySabotage",
    ImpostorDisconnect: "gameOver.ImpostorDisconnect",
    HumansDisconnect: "gameOver.HumansDisconnect",
    HideAndSeek_ImpostorsByKills: "gameOver.HideAndSeek_ImpostorsByKills",
    HideAndSeek_CrewmatesByTimer: "gameOver.HideAndSeek_CrewmatesByTimer",
};

/** Localized text of a vanilla game-over reason; modded or numeric values are shown as the escaped raw string. */
export function describeGameOverReason(reason: string, locale: Locale): string {
    const key = Object.hasOwn(VANILLA_REASONS, reason) ? VANILLA_REASONS[reason] : undefined;
    return key ? t(locale, key) : escapeName(reason);
}
