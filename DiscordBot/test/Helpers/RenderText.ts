import { ComponentType } from "discord.js";

interface RawComponent {
    type: number;
    content?: string;
    label?: string;
    placeholder?: string;
    components?: RawComponent[];
}

function describeComponent(component: RawComponent): string[] {
    switch (component.type) {
        case ComponentType.TextDisplay:
            return [component.content ?? ""];
        case ComponentType.Separator:
            return ["---"];
        case ComponentType.ActionRow:
            return [
                `[${(component.components ?? []).map((child) => child.label ?? child.placeholder ?? "?").join("] [")}]`,
            ];
        case ComponentType.Container:
            return (component.components ?? []).flatMap(describeComponent);
        default:
            return [`<component ${component.type}>`];
    }
}

/** A plain-text picture of a Components v2 message: text as written, separators as ---, rows as [labels]. */
export function renderText(components: unknown[]): string {
    return (components as RawComponent[]).flatMap(describeComponent).join("\n");
}
