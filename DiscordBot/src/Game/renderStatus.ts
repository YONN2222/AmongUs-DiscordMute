import { type Locale, t } from "../i18n";
import type { Phase } from "../Mute/voiceRules";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import { escapeName } from "./playerNames";

export interface StatusPlayer {
    name: string;
    discordId: string | null;
    dead: boolean;
}

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

function playerLine(player: StatusPlayer, locale: Locale): string {
    const who = player.discordId ? `<@${player.discordId}>` : t(locale, "status.notLinked");
    const dead = player.dead ? ` (${t(locale, "status.dead")})` : "";
    return `- ${escapeName(player.name)} - ${who}${dead}`;
}

function playerText(view: StatusView): string {
    if (view.players.length === 0) return t(view.locale, "status.noPlayers");
    const lines: string[] = [];
    let length = 0;
    for (const player of view.players) {
        const line = playerLine(player, view.locale);
        if (length + line.length + 1 > MAX_PLAYER_TEXT) break;
        lines.push(line);
        length += line.length + 1;
    }
    const hidden = view.players.length - lines.length;
    if (hidden > 0) lines.push(t(view.locale, "log.more", { count: hidden }));
    return lines.join("\n");
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
