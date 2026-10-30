import { type Locale, t } from "../I18n/Index";
import type { Phase } from "../Mute/VoiceRules";
import { ContainerBuilder, subtext } from "../Utils/ContainerBuilder";
import { type ListedPlayer, playerListText } from "./PlayerNames";

export type StatusPlayer = ListedPlayer;

export interface StatusView {
    phase: Phase;
    lobbyCode: string | null;
    lobbyCodeMode: "always" | "spoiler" | "never";
    hostDiscordId: string | null;
    players: StatusPlayer[];
    locale: Locale;
}

const MAX_PLAYER_TEXT = 3500;

function lobbyCodeText(view: StatusView): string | null {
    if (!view.lobbyCode || view.lobbyCodeMode === "never") return null;
    const code = view.lobbyCodeMode === "spoiler" ? `||${view.lobbyCode}||` : view.lobbyCode;
    return t(view.locale, "status.lobbyCode", { code });
}

function playerText(view: StatusView): string {
    if (view.players.length === 0) return t(view.locale, "status.noPlayers");
    return playerListText(view.players, view.locale, MAX_PLAYER_TEXT);
}

function subtitle(view: StatusView): string {
    const parts = [t(view.locale, "status.subtitle")];
    if (view.hostDiscordId) parts.push(t(view.locale, "status.host", { host: `<@${view.hostDiscordId}>` }));
    return subtext(parts.join(" | "));
}

/** Lobby, round and meeting each get their own accent so the phase is visible at a glance. */
function applyPhaseAccent(container: ContainerBuilder, phase: Phase): ContainerBuilder {
    if (phase === "tasks") return container.success();
    if (phase === "meeting") return container.warning();
    return container.info();
}

/** The components of the live game status message. */
export function renderStatus(view: StatusView): unknown[] {
    const { locale } = view;
    const header = [subtitle(view), lobbyCodeText(view)].filter((line): line is string => line !== null);
    const container = new ContainerBuilder()
        .title(t(locale, `status.phase.${view.phase}`))
        .text(header.join("\n"))
        .divider()
        .text(`**${t(locale, "status.players", { count: view.players.length })}**\n${playerText(view)}`)
        .footer();
    return [applyPhaseAccent(container, view.phase).toJSON()];
}
