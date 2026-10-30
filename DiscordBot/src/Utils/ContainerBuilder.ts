import {
    ContainerBuilder as DiscordContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} from "discord.js";
import { logTheme } from "../Logging/Logger";

/** The brand banner at the bottom of every message; the website serves it from Website/public/brand. */
export const FOOTER_BANNER_URL = "https://mute.yonn2222.com/brand/discord-footer.png";
const FOOTER_BANNER_DESCRIPTION = "DiscordMute";

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

    /** Closes the message with the brand banner; call it last so it stays at the bottom. */
    footer(): this {
        const banner = new MediaGalleryItemBuilder()
            .setURL(FOOTER_BANNER_URL)
            .setDescription(FOOTER_BANNER_DESCRIPTION);
        this.divider().addMediaGalleryComponents(new MediaGalleryBuilder().addItems(banner));
        return this;
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
