import { ContainerBuilder as DiscordContainerBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import { logTheme } from "../Logging/Logger";
import { BOT_VERSION } from "../Version";

export const WEBSITE_URL = "https://mute.yonn2222.com";
export const DOCS_URL = "https://docs.mute.yonn2222.com";

/** The small brand line at the bottom of every message the bot sends. */
export const FOOTER_TEXT = `-# [DiscordMute](${WEBSITE_URL}) v${BOT_VERSION} | [Docs](${DOCS_URL})`;

/** Discord's small grey subtext line. */
export function subtext(content: string): string {
    return `-# ${content}`;
}

function hexToNumber(color: number | string): number {
    if (typeof color === "number") return color;
    return Number.parseInt(color.replace(/^#/, ""), 16);
}

export class ContainerBuilder extends DiscordContainerBuilder {
    /** The heading of the message. The accent color carries success or failure, so there is no icon. */
    title(label: string): this {
        return this.text(`## ${label}`);
    }

    text(content: string): this {
        this.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        return this;
    }

    divider(size: SeparatorSpacingSize = SeparatorSpacingSize.Small): this {
        this.addSeparatorComponents((separator) => separator.setSpacing(size));
        return this;
    }

    /** Closes the message with the brand line; call it last so it stays at the bottom. */
    footer(): this {
        return this.divider().text(FOOTER_TEXT);
    }

    accent(color: number | string): this {
        return this.setAccentColor(hexToNumber(color));
    }

    success(): this {
        return this.accent(logTheme.embeds.green);
    }

    error(): this {
        return this.accent(logTheme.embeds.red);
    }

    info(): this {
        return this.accent(logTheme.embeds.blue);
    }

    warning(): this {
        return this.accent(logTheme.embeds.orange);
    }
}
