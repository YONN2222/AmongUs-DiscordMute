import { isHosted } from "../Hosted/HostedMode";
import type { Config } from "./ConfigSchema";

const DEFAULT_PLUGIN_SECRET = "change-me";

type WarnedConfig = Pick<Config, "mode" | "guildId" | "secret" | "channelIds">;

function hostedWarnings(config: WarnedConfig): string[] {
    const ignored = [config.secret !== undefined && '"secret"', config.channelIds.length > 0 && '"channelIds"'].filter(
        Boolean,
    );
    return ignored.length === 0
        ? []
        : [`config.json ${ignored.join(" and ")} are ignored in hosted mode. Servers set these up in /setup.`];
}

/** What a config.json still has that /setup replaces, one hint per setting. */
export function legacyConfigWarnings(config: WarnedConfig): string[] {
    if (isHosted(config)) return hostedWarnings(config);
    const warnings: string[] = [];
    if (config.secret !== undefined) {
        warnings.push(
            'config.json "secret" is deprecated. Run /setup in Discord, create the plugin secret on the General page, ' +
                'put it into the plugin config and remove "secret" from config.json. ' +
                "It stops working for your server as soon as /setup has created a secret.",
        );
    }
    if (config.secret === DEFAULT_PLUGIN_SECRET) {
        warnings.push(
            'config.json "secret" is "change-me", which is also what a plugin with a broken config sends. ' +
                "Anyone who can reach the bot port can connect. Create a secret in /setup now.",
        );
    }
    if (config.channelIds.length > 0) {
        warnings.push(
            config.guildId === undefined
                ? 'config.json "channelIds" is ignored without "guildId". Choose the fallback voice channels on the Voice page of /setup instead.'
                : 'config.json "channelIds" is deprecated. Choose the fallback voice channels on the Voice page of /setup ' +
                      'and remove "channelIds" from config.json.',
        );
    }
    return warnings;
}
