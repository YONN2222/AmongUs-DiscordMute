const DEFAULT_PLUGIN_SECRET = "change-me";

export function unauthorizedMessage(context: string, secret: unknown): string {
    if (secret === DEFAULT_PLUGIN_SECRET) {
        return (
            `${context}: the plugin is using the default secret "change-me". ` +
            `Its config.json is probably invalid JSON (e.g. single backslashes in the "exe" path), check BepInEx/LogOutput.log`
        );
    }
    return `${context}: secret does not match the bot config`;
}
