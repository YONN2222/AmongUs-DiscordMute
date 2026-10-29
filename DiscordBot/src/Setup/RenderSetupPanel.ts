import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from "discord.js";
import { type Locale, type MessageKey, t } from "../I18n/Index";
import type { GuildSettings } from "../Settings/GuildSettings";
import { ContainerBuilder } from "../Utils/ContainerBuilder";
import {
    type DELAY_FIELDS,
    DELETE_AFTER_MINUTES,
    LANGUAGES,
    LOBBY_CODE_MODES,
    NON_PLAYER_MODES,
    VOICE_ACTIONS,
} from "./ApplySetupInput";

export type SetupPage = "general" | "links" | "voice" | "game";

export const SETUP_PAGES: readonly SetupPage[] = ["general", "links", "voice", "game"];
export const SETUP_PREFIX = "setup";

interface Choice {
    value: string;
    label: string;
}

type Row = ActionRowBuilder<StringSelectMenuBuilder | ChannelSelectMenuBuilder | ButtonBuilder>;

function stringSelect(field: string, placeholder: string, choices: Choice[], selected: string): Row {
    const select = new StringSelectMenuBuilder()
        .setCustomId(`${SETUP_PREFIX}:${field}`)
        .setPlaceholder(placeholder)
        .addOptions(
            choices.map((choice) =>
                new StringSelectMenuOptionBuilder()
                    .setValue(choice.value)
                    .setLabel(choice.label)
                    .setDefault(choice.value === selected),
            ),
        );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select) as Row;
}

function channelSelect(field: string, locale: Locale, current: string | null): Row {
    const select = new ChannelSelectMenuBuilder()
        .setCustomId(`${SETUP_PREFIX}:${field}`)
        .setPlaceholder(t(locale, "setup.channel.placeholder"))
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1);
    if (current) select.setDefaultChannels(current);
    return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select) as Row;
}

function button(field: string, label: string, enabled: boolean | null): Row {
    const style = enabled === null ? ButtonStyle.Primary : enabled ? ButtonStyle.Success : ButtonStyle.Secondary;
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${SETUP_PREFIX}:${field}`).setLabel(label).setStyle(style),
    ) as Row;
}

function toggle(field: string, name: MessageKey, enabled: boolean, locale: Locale): Row {
    const state = t(locale, enabled ? "setup.state.on" : "setup.state.off");
    return button(field, t(locale, "setup.toggle", { name: t(locale, name), state }), enabled);
}

function section(container: ContainerBuilder, label: string, row: Row): void {
    container.text(label).addActionRowComponents(row as never);
}

function choices(locale: Locale, values: readonly (string | number)[], key: (value: string) => MessageKey): Choice[] {
    return values.map((value) => ({ value: String(value), label: t(locale, key(String(value))) }));
}

function durationLabel(locale: Locale, minutes: number): string {
    if (minutes === 0) return t(locale, "setup.duration.keep");
    if (minutes >= 60) return t(locale, "setup.duration.hours", { count: minutes / 60 });
    return t(locale, "setup.duration.minutes", { count: minutes });
}

function pageSelect(page: SetupPage, locale: Locale): Row {
    return stringSelect(
        "page",
        t(locale, "setup.page.placeholder"),
        choices(locale, SETUP_PAGES, (value) => `setup.page.${value}` as MessageKey),
        page,
    );
}

function generalPage(container: ContainerBuilder, settings: GuildSettings, locale: Locale, connected: boolean): void {
    section(
        container,
        t(locale, "setup.general.language"),
        stringSelect(
            "language",
            t(locale, "setup.general.language"),
            choices(locale, LANGUAGES, (value) => `setup.language.${value}` as MessageKey),
            settings.language,
        ),
    );
    section(
        container,
        t(locale, "setup.general.logChannel"),
        channelSelect("logChannelId", locale, settings.logChannelId),
    );
    container.divider().text(t(locale, connected ? "setup.plugin.connected" : "setup.plugin.disconnected"));
}

function linksPage(container: ContainerBuilder, settings: GuildSettings, locale: Locale): void {
    section(
        container,
        t(locale, "setup.links.overview"),
        channelSelect("linkOverview.channelId", locale, settings.linkOverview.channelId),
    );
    container
        .addActionRowComponents(
            toggle(
                "linkOverview.showPending",
                "setup.links.showPending",
                settings.linkOverview.showPending,
                locale,
            ) as never,
        )
        .addActionRowComponents(toggle("autoRelink", "setup.links.autoRelink", settings.autoRelink, locale) as never);
}

function voiceRuleSelect(
    container: ContainerBuilder,
    settings: GuildSettings,
    locale: Locale,
    phase: "tasks" | "meeting",
    role: "alive" | "dead",
): void {
    section(
        container,
        t(locale, `setup.voice.${phase}.${role}` as MessageKey),
        stringSelect(
            `voiceRules.${phase}.${role}`,
            t(locale, `setup.voice.${phase}.${role}` as MessageKey),
            choices(locale, VOICE_ACTIONS, (value) => `setup.voice.action.${value}` as MessageKey),
            settings.voiceRules[phase][role],
        ),
    );
}

function delaysSummary(settings: GuildSettings, locale: Locale): string {
    const seconds = (name: (typeof DELAY_FIELDS)[number]) => settings.delaysMs[name] / 1000;
    return t(locale, "setup.voice.delays", {
        gameStart: seconds("gameStart"),
        meetingStart: seconds("meetingStart"),
        meetingEnd: seconds("meetingEnd"),
        lobby: seconds("lobby"),
    });
}

function voicePage(container: ContainerBuilder, settings: GuildSettings, locale: Locale): void {
    voiceRuleSelect(container, settings, locale, "tasks", "alive");
    voiceRuleSelect(container, settings, locale, "tasks", "dead");
    voiceRuleSelect(container, settings, locale, "meeting", "alive");
    voiceRuleSelect(container, settings, locale, "meeting", "dead");
    container
        .divider()
        .text(t(locale, "setup.voice.ghostChat.warning"))
        .addActionRowComponents(toggle("ghostChat", "setup.voice.ghostChat", settings.ghostChat, locale) as never);
    section(
        container,
        t(locale, "setup.voice.nonPlayers"),
        stringSelect(
            "nonPlayers",
            t(locale, "setup.voice.nonPlayers"),
            choices(locale, NON_PLAYER_MODES, (value) => `setup.voice.nonPlayers.${value}` as MessageKey),
            settings.nonPlayers,
        ),
    );
    section(container, delaysSummary(settings, locale), button("delays", t(locale, "setup.voice.editDelays"), null));
}

function gamePage(container: ContainerBuilder, settings: GuildSettings, locale: Locale): void {
    section(
        container,
        t(locale, "setup.game.statusChannel"),
        channelSelect("status.channelId", locale, settings.status.channelId),
    );
    section(
        container,
        t(locale, "setup.game.lobbyCode"),
        stringSelect(
            "status.lobbyCode",
            t(locale, "setup.game.lobbyCode"),
            choices(locale, LOBBY_CODE_MODES, (value) => `setup.game.lobbyCode.${value}` as MessageKey),
            settings.status.lobbyCode,
        ),
    );
    section(
        container,
        t(locale, "setup.game.summaryChannel"),
        channelSelect("summary.channelId", locale, settings.summary.channelId),
    );
    section(
        container,
        t(locale, "setup.game.deleteAfter"),
        stringSelect(
            "summary.deleteAfterMinutes",
            t(locale, "setup.game.deleteAfter"),
            DELETE_AFTER_MINUTES.map((minutes) => ({ value: String(minutes), label: durationLabel(locale, minutes) })),
            String(settings.summary.deleteAfterMinutes),
        ),
    );
    container.addActionRowComponents(
        toggle("nicknameSync", "setup.game.nicknameSync", settings.nicknameSync, locale) as never,
    );
}

/** The ephemeral settings panel of one page. Every value shown is the stored one. */
export function renderSetupPanel(
    settings: GuildSettings,
    page: SetupPage,
    locale: Locale,
    pluginConnected: boolean,
): unknown[] {
    const container = new ContainerBuilder().title(t(locale, "setup.title"), null).info();
    container.addActionRowComponents(pageSelect(page, locale) as never).divider();
    switch (page) {
        case "general":
            generalPage(container, settings, locale, pluginConnected);
            break;
        case "links":
            linksPage(container, settings, locale);
            break;
        case "voice":
            voicePage(container, settings, locale);
            break;
        case "game":
            gamePage(container, settings, locale);
            break;
    }
    return [container.toJSON()];
}
