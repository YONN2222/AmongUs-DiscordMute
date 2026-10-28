import type { LinkRepository } from "../Data/repositories/LinkRepository";
import { logger, logModules } from "../Logging/logger";
import type { VoiceTarget } from "./VoiceTarget";

export interface VoiceTargetResolverDeps {
    links: Pick<LinkRepository, "findByAccountName">;
    memberVoiceChannel: (guildId: string, discordId: string) => Promise<string | null>;
    fallbackChannelIds: string[];
}

export function createVoiceTargetResolver(
    deps: VoiceTargetResolverDeps,
): (guildId: string, hostAccountName: string) => Promise<VoiceTarget> {
    const fallback = (notice: Extract<VoiceTarget, { notice: unknown }>): VoiceTarget =>
        deps.fallbackChannelIds.length > 0 ? { channelIds: [...deps.fallbackChannelIds] } : notice;

    return async (guildId, hostAccountName) => {
        const matches = await deps.links.findByAccountName(guildId, hostAccountName);
        const hosts = new Set(matches.map((entry) => entry.discordId));
        if (hosts.size !== 1) {
            return fallback({
                notice: { code: "host-not-linked", message: "Link your own Discord account first with /link self." },
            });
        }
        const [hostId] = hosts;
        let channelId: string | null = null;
        try {
            channelId = await deps.memberVoiceChannel(guildId, hostId);
        } catch (err) {
            logger.error(logModules.Mute, `Could not look up the voice channel of ${hostId} in guild ${guildId}`, err);
        }
        if (channelId === null) {
            return fallback({
                notice: {
                    code: "host-not-in-voice",
                    message: "Join a voice channel in Discord so DiscordMute knows where your game is.",
                },
            });
        }
        return { channelIds: [channelId] };
    };
}
