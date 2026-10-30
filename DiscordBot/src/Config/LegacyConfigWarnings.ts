import { isHosted } from "../Hosted/HostedMode";
import type { Config } from "./ConfigSchema";

/** What a self-hoster still has in config.json that /setup replaces, one hint per setting. */
export function legacyConfigWarnings(config: Pick<Config, "mode" | "secret" | "channelIds">): string[] {
    if (isHosted(config)) return [];
    const warnings: string[] = [];
    if (config.secret !== undefined) {
        warnings.push(
            'config.json "secret" is deprecated. Run /setup in Discord, create the plugin secret on the General page, ' +
                'put it into the plugin config and remove "secret" from config.json.',
        );
    }
    if (config.channelIds.length > 0) {
        warnings.push(
            'config.json "channelIds" is deprecated. Choose the fallback voice channels on the Voice page of /setup ' +
                'and remove "channelIds" from config.json.',
        );
    }
    return warnings;
}
