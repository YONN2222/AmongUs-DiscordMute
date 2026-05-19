import { ContainerBuilder as DiscordContainerBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import { logTheme } from "../Logging/logger";

type HeadingDepth = 1 | 2 | 3;

const headingMarks: Record<HeadingDepth, string> = {
    1: "#",
    2: "##",
    3: "###",
};

function normalizeHeadingDepth(depth: number): HeadingDepth {
    if (depth <= 1) return 1;
    if (depth === 2) return 2;
    return 3;
}

function hexToNumber(color: number | string): number {
    if (typeof color === "number") return color;
    return Number.parseInt(color.replace(/^#/, ""), 16);
}

export class ContainerBuilder extends DiscordContainerBuilder {
    title(label: string, icon?: string | null, depth = 2): this {
        const prefix = headingMarks[normalizeHeadingDepth(depth)];
        const content = icon ? `${prefix} ${icon} ${label}` : `${prefix} ${label}`;
        return this.text(content);
    }

    text(content: string): this {
        this.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        return this;
    }

    divider(size: SeparatorSpacingSize = SeparatorSpacingSize.Small): this {
        this.addSeparatorComponents((separator) => separator.setSpacing(size));
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
