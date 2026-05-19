import type { Client, GuildMember } from "discord.js";
import type { Config } from "../Infrastructure/ConfigSchema";
import { logger, logModules } from "../Logging/logger";
import { linkingService } from "./LinkingService";

export class MuteService {
    constructor(
        private readonly client: Client,
        private readonly config: Config,
    ) {}

    async mutePlayers(playerNames: string[]): Promise<void> {
        const linkedDiscordIds = new Set<string>();
        const allLinks = linkingService.getAllLinks();

        for (const name of playerNames) {
            const nameLower = name.toLowerCase();
            const link = allLinks.find((l) => {
                const stored = l.accountName.toLowerCase();
                if (stored === nameLower) return true;
                const afterPipe = stored.includes(" | ") ? stored.split(" | ").pop() : null;
                return afterPipe !== null && afterPipe === nameLower;
            });
            if (link) {
                linkedDiscordIds.add(link.discordId);
            }
        }

        if (linkedDiscordIds.size === 0) {
            logger.info(logModules.Mute, "No linked players found in the current game. Skipping mute.");
            return;
        }

        await this.setMuteFiltered(true, linkedDiscordIds);
    }

    async unmuteAll(): Promise<void> {
        await this.setMuteAll(false);
    }

    async handleMeetingStart(alivePlayers: string[], deadPlayers: string[]): Promise<void> {
        await this.unmutePlayers(alivePlayers);
        await this.mutePlayers(deadPlayers);
    }

    private async unmutePlayers(playerNames: string[]): Promise<void> {
        const linkedDiscordIds = new Set<string>();
        const allLinks = linkingService.getAllLinks();

        for (const name of playerNames) {
            const nameLower = name.toLowerCase();
            const link = allLinks.find((l) => {
                const stored = l.accountName.toLowerCase();
                if (stored === nameLower) return true;
                const afterPipe = stored.includes(" | ") ? stored.split(" | ").pop() : null;
                return afterPipe !== null && afterPipe === nameLower;
            });
            if (link) linkedDiscordIds.add(link.discordId);
        }

        if (linkedDiscordIds.size === 0) return;
        await this.setMuteFiltered(false, linkedDiscordIds);
    }

    private async setMuteFiltered(mute: boolean, discordIds: Set<string>): Promise<void> {
        const action = mute ? "Muting" : "Unmuting";
        const guild = this.client.guilds.cache.get(this.config.guildId);
        if (!guild) return;

        for (const channelId of this.config.channelIds) {
            const channel = guild.channels.cache.get(channelId);
            if (!channel?.isVoiceBased()) continue;

            await Promise.allSettled(
                channel.members
                    .filter((member) => discordIds.has(member.id))
                    .map((member: GuildMember) => {
                        logger.debug(logModules.Mute, `${action} linked member: ${member.user.tag} (${member.id})`);
                        return member.voice.setMute(mute, `DiscordMute: game event`);
                    }),
            );
        }
    }

    private async setMuteAll(mute: boolean): Promise<void> {
        const action = mute ? "Muting" : "Unmuting";

        const guild = this.client.guilds.cache.get(this.config.guildId);
        if (!guild) {
            logger.warn(logModules.Mute, `Guild ${this.config.guildId} not found in cache`);
            return;
        }

        logger.info(logModules.Mute, `${action} all members in ${this.config.channelIds.length} channel(s)`);

        for (const channelId of this.config.channelIds) {
            const channel = guild.channels.cache.get(channelId);
            if (!channel?.isVoiceBased()) {
                logger.warn(logModules.Mute, `Channel ${channelId} not found or not a voice channel`);
                continue;
            }

            const results = await Promise.allSettled(
                channel.members.map((member: GuildMember) => {
                    logger.debug(logModules.Mute, `${action} member: ${member.user.tag} (${member.id})`);
                    return member.voice.setMute(mute, `DiscordMute: game event`);
                }),
            );

            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) {
                logger.warn(
                    logModules.Mute,
                    `${failed} member(s) could not be ${mute ? "muted" : "unmuted"} in #${channel.name}`,
                );
            }
        }

        logger.success(logModules.Mute, `${action} complete`);
    }
}
