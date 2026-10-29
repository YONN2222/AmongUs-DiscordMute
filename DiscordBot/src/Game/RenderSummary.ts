import { accountNameKeys, normalizeAccountName } from "../Data/AccountNameMatch";
import { type Locale, t } from "../I18n/Index";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { describeGameOverReason } from "./GameOverReason";
import { escapeName, type ListedPlayer, playerListText } from "./PlayerNames";

export type SummaryPlayer = ListedPlayer;

export interface SummaryView {
    reason: string;
    winners: string[];
    players: SummaryPlayer[];
    durationMs: number | null;
    locale: Locale;
    /** Optional Discord ids of the winners, index-aligned with `winners`, when the caller resolved them itself. */
    winnerDiscordIds?: Array<string | null>;
}

const MAX_PLAYER_TEXT = 3000;
const SECONDS_PER_HOUR = 3600;

export function formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The winner list carries raw names while the roster may carry overridden ones, so both sides are matched loosely. */
function playerForWinner(winner: string, players: SummaryPlayer[]): SummaryPlayer | null {
    const winnerKey = normalizeAccountName(winner);
    const winnerKeys = accountNameKeys(winner);
    const matches = players.filter(
        (player) =>
            accountNameKeys(player.name).includes(winnerKey) || winnerKeys.includes(normalizeAccountName(player.name)),
    );
    return matches.length === 1 ? matches[0] : null;
}

function winnerText(view: SummaryView): string {
    if (view.winners.length === 0) return t(view.locale, "log.none");
    return view.winners
        .map((winner, index) => {
            const id = view.winnerDiscordIds?.[index] ?? playerForWinner(winner, view.players)?.discordId ?? null;
            return id ? `<@${id}>` : escapeName(winner);
        })
        .join(", ");
}

/** The components of the match summary posted after a game. */
export function renderSummary(view: SummaryView): unknown[] {
    const { locale } = view;
    const container = new ContainerBuilder().title(t(locale, "summary.title"), null).success();
    const header = [
        t(locale, "summary.result", { reason: describeGameOverReason(view.reason, locale) }),
        t(locale, "summary.winners", { winners: winnerText(view) }),
    ];
    if (view.durationMs !== null) {
        header.push(t(locale, "summary.duration", { duration: formatDuration(view.durationMs) }));
    }
    container.text(header.join("\n"));
    if (view.players.length > 0) {
        container
            .divider()
            .text(
                `**${t(locale, "summary.players", { count: view.players.length })}**\n${playerListText(view.players, locale, MAX_PLAYER_TEXT)}`,
            );
    }
    return [container.toJSON()];
}
