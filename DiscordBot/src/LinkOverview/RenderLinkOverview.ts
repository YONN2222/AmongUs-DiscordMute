import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    escapeMarkdown,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from "discord.js";
import type { LinkEntry } from "../Data/Repositories/LinkRepository";
import { escapeName } from "../Game/PlayerNames";
import { type Locale, t } from "../I18n/Index";
import { ContainerBuilder, subtext } from "../Utils/ContainerBuilder";

export const PAGE_SIZE = 20;
export const PENDING_SHOWN = 10;

const SELECT_LABEL_MAX = 100;

export interface LinkOverviewView {
    /** The links of the page being shown. */
    entries: LinkEntry[];
    /** All links of the guild. */
    total: number;
    /** Zero-based page index. */
    page: number;
    pending?: { discordIds: string[]; total: number };
    locale: Locale;
    /** "public" is the self-updating channel message, "ephemeral" the private paged view. */
    mode: "public" | "ephemeral";
    /** Admin controls appear in the ephemeral view only. */
    isAdmin: boolean;
}

export function pageCount(total: number): number {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function entryLine(entry: LinkEntry): string {
    return `- **${escapeName(entry.accountName)}** <@${entry.discordId}>`;
}

function button(customId: string, label: string, style: ButtonStyle, disabled = false): ButtonBuilder {
    return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function row(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

function pendingText(view: LinkOverviewView): string | null {
    if (!view.pending || view.pending.discordIds.length === 0) return null;
    const users = view.pending.discordIds.map((id) => `<@${id}>`).join(", ");
    const hidden = view.pending.total - view.pending.discordIds.length;
    return subtext(
        t(view.locale, "overview.pending", {
            users: hidden > 0 ? `${users} ${t(view.locale, "log.more", { count: hidden })}` : users,
        }),
    );
}

function navigationRow(view: LinkOverviewView, pages: number): ActionRowBuilder<ButtonBuilder> {
    const { locale, page } = view;
    return row(
        button(`lo:page:${page - 1}`, t(locale, "overview.button.prev"), ButtonStyle.Secondary, page <= 0),
        button(`lo:page:${page + 1}`, t(locale, "overview.button.next"), ButtonStyle.Secondary, page >= pages - 1),
    );
}

function adminRows(view: LinkOverviewView): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    if (view.entries.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(`lo:admin-unlink:${view.page}`)
            .setPlaceholder(t(view.locale, "overview.admin.unlinkPlaceholder"))
            .addOptions(
                view.entries
                    .slice(0, PAGE_SIZE)
                    .map((entry) =>
                        new StringSelectMenuOptionBuilder()
                            .setValue(entry.discordId)
                            .setLabel(escapeMarkdown(entry.accountName).slice(0, SELECT_LABEL_MAX) || "-"),
                    ),
            );
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }
    rows.push(row(button("lo:admin-force", t(view.locale, "overview.admin.force"), ButtonStyle.Secondary)));
    return rows;
}

/** The components of the link overview, either the public channel message or the private paged view. */
export function renderLinkOverview(view: LinkOverviewView): unknown[] {
    const { locale, mode } = view;
    const pages = pageCount(view.total);
    const container = new ContainerBuilder().title(t(locale, "overview.title")).info();

    const counter =
        mode === "ephemeral"
            ? `${t(locale, "overview.count", { count: view.total })} | ${t(locale, "overview.page", { page: view.page + 1, pages })}`
            : t(locale, "overview.count", { count: view.total });
    container.text(subtext(counter)).divider();

    const shown = view.entries.slice(0, PAGE_SIZE);
    container.text(shown.length > 0 ? shown.map(entryLine).join("\n") : t(locale, "overview.empty"));

    const waiting = pendingText(view);
    if (waiting) container.divider().text(waiting);
    container.footer();

    const components: { toJSON(): unknown }[] = [container];
    if (mode === "public") {
        components.push(
            row(
                button("lo:link", t(locale, "overview.button.link"), ButtonStyle.Primary),
                button("lo:unlink", t(locale, "overview.button.unlink"), ButtonStyle.Secondary),
                button("lo:more", t(locale, "overview.button.more"), ButtonStyle.Secondary),
            ),
        );
    } else {
        components.push(navigationRow(view, pages));
        if (view.isAdmin) components.push(...adminRows(view));
    }
    return components.map((component) => component.toJSON());
}
