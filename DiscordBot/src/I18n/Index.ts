import { de } from "./De";
import { en, type MessageKey } from "./En";

export type { MessageKey } from "./En";
export type Locale = "en" | "de";

const messages: Record<Locale, Record<MessageKey, string>> = { en, de };

export function t(locale: Locale, key: MessageKey, params: Record<string, string | number> = {}): string {
    return messages[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
    );
}

export function localeFrom(discordLocale: string | null | undefined): Locale {
    return discordLocale?.startsWith("de") ? "de" : "en";
}

export function descriptionLocalizations(key: MessageKey): { de: string } {
    return { de: de[key] };
}

interface DescribableBuilder {
    setDescription(description: string): unknown;
    setDescriptionLocalizations(localizations: { de: string }): unknown;
}

/** Sets the english description and its german localization on a slash command, subcommand or option builder. */
export function localized<B extends DescribableBuilder>(builder: B, key: MessageKey): B {
    builder.setDescription(en[key]);
    builder.setDescriptionLocalizations(descriptionLocalizations(key));
    return builder;
}
