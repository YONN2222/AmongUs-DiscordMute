import { type Locale, t } from "../i18n";
import type { Phase } from "../Mute/voiceRules";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { type ListedPlayer, playerListText } from "./playerNames";

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

/** The components of the live game status message. */
export function renderStatus(view: StatusView): unknown[] {
    const { locale } = view;
    const container = new ContainerBuilder().title(t(locale, "status.title"), null).info();
    const header = [t(locale, `status.phase.${view.phase}`), lobbyCodeText(view)];
    if (view.hostDiscordId) header.push(t(locale, "status.host", { host: `<@${view.hostDiscordId}>` }));
    container
        .text(header.filter((line): line is string => line !== null).join("\n"))
        .divider()
        .text(`**${t(locale, "status.players", { count: view.players.length })}**\n${playerText(view)}`);
    return [container.toJSON()];
}
