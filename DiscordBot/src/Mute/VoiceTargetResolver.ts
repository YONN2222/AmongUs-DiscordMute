import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import { type Locale, type MessageKey, t } from "../I18n/Index";
import { logger, logModules } from "../Logging/Logger";
import type { GatewayNotice } from "../Protocol/PluginProtocol";
import type { VoiceTarget } from "./VoiceTarget";

export interface VoiceTargetResolverDeps {
    links: Pick<LinkRepository, "findByAccountName">;
    memberVoiceChannel: (guildId: string, discordId: string) => Promise<string | null>;
    /** Voice channels to control when the host is not in one: from the config in self-host, from the guild settings when hosted. */
    fallbackChannelIds: (guildId: string) => Promise<string[]>;
    localeOf: (guildId: string) => Promise<Locale>;
    /** Hosted mode only: a game whose linked host is blocked is not controlled. */
    isUserBlocked?: (userId: string) => Promise<boolean>;
}

export function createVoiceTargetResolver(
    deps: VoiceTargetResolverDeps,
): (guildId: string, hostAccountName: string) => Promise<VoiceTarget> {
    const notice = async (guildId: string, code: GatewayNotice["code"], key: MessageKey): Promise<VoiceTarget> => {
        let locale: Locale = "en";
        try {
            locale = await deps.localeOf(guildId);
        } catch (err) {
            logger.error(logModules.Mute, `Could not look up the language of guild ${guildId}`, err);
        }
        return { notice: { code, message: t(locale, key) } };
    };

    const noticeOrFallback = async (
        guildId: string,
        code: "host-not-linked" | "host-not-in-voice",
        key: MessageKey,
    ): Promise<VoiceTarget> => {
        const fallbackChannelIds = await deps.fallbackChannelIds(guildId);
        if (fallbackChannelIds.length > 0) return { channelIds: [...fallbackChannelIds] };
        return notice(guildId, code, key);
    };

    return async (guildId, hostAccountName) => {
        const matches = await deps.links.findByAccountName(guildId, hostAccountName);
        const hosts = new Set(matches.map((entry) => entry.discordId));
        if (hosts.size !== 1) return noticeOrFallback(guildId, "host-not-linked", "notice.hostNotLinked");
        const [hostId] = hosts;
        // No fallback channels here: a blocked host's game must not be controlled at all.
        if (await deps.isUserBlocked?.(hostId)) return notice(guildId, "host-blocked", "notice.hostBlocked");
        let channelId: string | null = null;
        try {
            channelId = await deps.memberVoiceChannel(guildId, hostId);
        } catch (err) {
            logger.error(logModules.Mute, `Could not look up the voice channel of ${hostId} in guild ${guildId}`, err);
        }
        if (channelId === null) return noticeOrFallback(guildId, "host-not-in-voice", "notice.hostNotInVoice");
        return { channelIds: [channelId] };
    };
}
