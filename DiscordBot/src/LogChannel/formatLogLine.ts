import { escapeMarkdown } from "discord.js";
import type { GuildEvent } from "../Events/GuildEvents";
import { type Locale, t } from "../i18n";
import type { GuildSettings } from "../Settings/GuildSettings";

type EventOf<T extends GuildEvent["type"]> = Extract<GuildEvent, { type: T }>;

const mention = (discordId: string) => `<@${discordId}>`;

function nameList(names: string[], locale: Locale): string {
    return names.length === 0 ? t(locale, "log.none") : names.map((name) => escapeMarkdown(name)).join(", ");
}

function settingAt(settings: GuildSettings, path: string): unknown {
    let value: unknown = settings;
    for (const key of path.split(".")) {
        if (typeof value !== "object" || value === null) return undefined;
        value = (value as Record<string, unknown>)[key];
    }
    return value;
}

function settingValue(path: string, value: unknown, locale: Locale): string {
    const isChannel = path === "logChannelId" || path.endsWith(".channelId");
    if (value === null || value === undefined) return t(locale, "log.none");
    return isChannel ? `<#${String(value)}>` : String(value);
}

function linkChanged(event: EventOf<"link-changed">, locale: Locale, names: (discordId: string) => string): string {
    const user = mention(event.discordId);
    const name = escapeMarkdown(event.accountName ?? names(event.discordId));
    switch (event.change) {
        case "linked":
            return t(locale, "log.linked", { user, name });
        case "force-linked": {
            const actor = event.actorId ? mention(event.actorId) : t(locale, "log.someone");
            return t(locale, "log.forceLinked", { actor, user, name });
        }
        case "relinked":
            return t(locale, "log.relinked", { user, name });
        case "unlinked":
            return event.previousName
                ? t(locale, "log.unlinkedFrom", { user, name: escapeMarkdown(event.previousName) })
                : t(locale, "log.unlinked", { user });
    }
}

function settingsChanged(event: EventOf<"settings-changed">, locale: Locale): string {
    const changes = event.paths
        .map((path) => {
            const before = settingValue(path, settingAt(event.before, path), locale);
            const after = settingValue(path, settingAt(event.after, path), locale);
            return `- ${path}: ${before} -> ${after}`;
        })
        .join("\n");
    return t(locale, "log.settingsChanged", { actor: mention(event.actorId), changes });
}

function voiceError(event: EventOf<"voice-error">, locale: Locale, names: (discordId: string) => string): string {
    const label = event.discordId
        ? [mention(event.discordId), escapeMarkdown(names(event.discordId))].filter(Boolean).join(" ")
        : "";
    const member = label ? t(locale, "log.forMember", { user: label }) : "";
    return t(locale, event.code === "missing-permission" ? "log.voiceMissingPermission" : "log.voiceNotEditable", {
        member,
    });
}

/**
 * One public log line for a guild event, or null when the event is not logged. Mentions stay plain text because
 * the writer sends with `allowedMentions: { parse: [] }`.
 */
export function formatLogLine(event: GuildEvent, locale: Locale, names: (discordId: string) => string): string | null {
    switch (event.type) {
        case "session-started":
            return t(locale, "log.sessionStarted", {
                pluginVersion: escapeMarkdown(event.pluginVersion),
                gameVersion: escapeMarkdown(event.gameVersion),
            });
        case "session-ended":
            return t(locale, "log.sessionEnded");
        case "game-event": {
            if (event.event !== "game-start") return null;
            const count = event.players.length + event.deadPlayers.length;
            const [channelId] = event.channelIds;
            return channelId
                ? t(locale, "log.gameStarted", { channel: `<#${channelId}>`, count })
                : t(locale, "log.gameStartedNoChannel", { count });
        }
        case "game-ended":
            return t(locale, "log.gameEnded", {
                reason: escapeMarkdown(event.reason),
                winners: nameList(event.winners, locale),
                dead: nameList(
                    event.roster.filter((entry) => entry.dead).map((entry) => entry.name),
                    locale,
                ),
            });
        case "link-changed":
            return linkChanged(event, locale, names);
        case "settings-changed":
            return settingsChanged(event, locale);
        case "voice-error":
            return voiceError(event, locale, names);
        case "pending-changed":
            return null;
    }
}
