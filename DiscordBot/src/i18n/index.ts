import { de } from "./de";
import { en, type MessageKey } from "./en";

export type { MessageKey } from "./en";
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
