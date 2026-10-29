import { accountNameKeys, normalizeAccountName } from "../Data/accountNameMatch";
import type { LinkRepository } from "../Data/repositories/LinkRepository";
import type { NicknameLedgerEntry, NicknameLedgerRepository } from "../Data/repositories/NicknameLedgerRepository";
import type { GuildEvent, GuildEventBus } from "../Events/GuildEvents";
import { logger, logModules } from "../Logging/logger";
import type { SettingsService } from "../Settings/SettingsService";
import { GuildQueue } from "../Utils/GuildQueue";

const MAX_NICKNAME_LENGTH = 32;
const DISCORD_MISSING_PERMISSIONS = 50013;

export interface NicknameAdapter {
    /** Resolves to null only when the member is not in the guild (anymore); other lookup failures throw. */
    nicknameOf(guildId: string, discordId: string): Promise<{ nick: string | null } | null>;
    setNickname(guildId: string, discordId: string, nick: string | null): Promise<void>;
    /** The voice channel the member is in, or null when they are in none. */
    voiceChannelOf(guildId: string, discordId: string): Promise<string | null>;
}

export interface NicknameSyncDeps {
    adapter: NicknameAdapter;
    ledger: NicknameLedgerRepository;
    links: LinkRepository;
    settings: Pick<SettingsService, "get">;
    events: Pick<GuildEventBus, "emit">;
}

function isMissingPermission(err: unknown): boolean {
    return typeof err === "object" && err !== null && "code" in err && err.code === DISCORD_MISSING_PERMISSIONS;
}

/** Only an unknown member is final; missing permissions come back once an admin fixes the roles. */
function isMemberGone(err: unknown): boolean {
    return typeof err === "object" && err !== null && "code" in err && err.code === 10007;
}

function truncate(name: string): string {
    return [...name].slice(0, MAX_NICKNAME_LENGTH).join("");
}

/** Shows the Among Us name as server nickname while a game runs and puts the old nickname back afterwards. */
export class NicknameSync {
    private readonly queue = new GuildQueue();
    private readonly reportedGames = new Set<string>();

    constructor(private readonly deps: NicknameSyncDeps) {}

    handle(event: GuildEvent): Promise<void> {
        // session-ended is restored by the cluster request handler, which awaits it before the cluster can stop.
        if (event.type === "game-event" && event.event === "lobby") return this.restoreGuild(event.guildId);
        if (event.type !== "game-event" || event.event !== "game-start") return Promise.resolve();
        const { guildId } = event;
        return this.queue.run(guildId, async () => {
            if (!(await this.deps.settings.get(guildId)).nicknameSync) return;
            await this.applyNames(guildId, event.players, event.channelIds);
        });
    }

    restoreGuild(guildId: string): Promise<void> {
        return this.queue.run(guildId, async () => {
            this.reportedGames.delete(guildId);
            for (const entry of await this.deps.ledger.listByGuild(guildId)) await this.restoreOne(entry);
        });
    }

    /** Runs once on cluster ready so nicknames left behind by a crash are put back. */
    async recover(guildIds: string[]): Promise<void> {
        const guilds = new Set((await this.deps.ledger.listByGuilds(guildIds)).map((entry) => entry.guildId));
        await Promise.all([...guilds].map((guildId) => this.restoreGuild(guildId)));
    }

    private async applyNames(guildId: string, players: string[], channelIds: string[]): Promise<void> {
        if (channelIds.length === 0) return;
        const targets = await this.resolveTargets(guildId, players);
        const ledger = new Map((await this.deps.ledger.listByGuild(guildId)).map((entry) => [entry.discordId, entry]));
        for (const [discordId, nick] of targets) {
            try {
                await this.applyOne(guildId, discordId, nick, channelIds, ledger.get(discordId));
            } catch (err) {
                logger.error(logModules.Discord, `Guild ${guildId}, member ${discordId}: nickname update failed`, err);
            }
        }
    }

    /** Players whose name belongs to exactly one link, with the nickname they should get. */
    private async resolveTargets(guildId: string, players: string[]): Promise<Map<string, string>> {
        const byKey = new Map<string, Set<string>>();
        for (const link of await this.deps.links.listByGuild(guildId)) {
            for (const key of accountNameKeys(link.accountName)) {
                const ids = byKey.get(key) ?? new Set<string>();
                ids.add(link.discordId);
                byKey.set(key, ids);
            }
        }
        const targets = new Map<string, string>();
        for (const raw of players) {
            const name = raw.trim();
            const ids = byKey.get(normalizeAccountName(name));
            if (name === "" || ids?.size !== 1) continue;
            const [discordId] = ids;
            targets.set(discordId, truncate(name));
        }
        return targets;
    }

    private async applyOne(
        guildId: string,
        discordId: string,
        nick: string,
        channelIds: string[],
        previous: NicknameLedgerEntry | undefined,
    ): Promise<void> {
        const channelId = await this.deps.adapter.voiceChannelOf(guildId, discordId);
        if (channelId === null || !channelIds.includes(channelId)) return;
        const member = await this.deps.adapter.nicknameOf(guildId, discordId);
        if (!member || member.nick === nick) return;

        // Only a nickname the bot set itself can be put back, so a changed one never overwrites the real original.
        const originalNick = previous && previous.appliedNick === member.nick ? previous.originalNick : member.nick;
        await this.deps.ledger.set(guildId, discordId, originalNick, nick);
        try {
            await this.deps.adapter.setNickname(guildId, discordId, nick);
        } catch (err) {
            await this.revertLedger(guildId, discordId, previous);
            if (!isMissingPermission(err)) throw err;
            logger.warn(logModules.Discord, `Guild ${guildId}, member ${discordId}: nickname cannot be changed`);
            if (!this.reportedGames.has(guildId)) {
                this.reportedGames.add(guildId);
                this.deps.events.emit({ type: "voice-error", guildId, code: "member-not-editable", discordId });
            }
        }
    }

    private async revertLedger(
        guildId: string,
        discordId: string,
        previous: NicknameLedgerEntry | undefined,
    ): Promise<void> {
        try {
            if (previous) await this.deps.ledger.set(guildId, discordId, previous.originalNick, previous.appliedNick);
            else await this.deps.ledger.remove(guildId, discordId);
        } catch (err) {
            logger.error(
                logModules.Database,
                `Guild ${guildId}, member ${discordId}: could not restore the ledger`,
                err,
            );
        }
    }

    private async restoreOne(entry: NicknameLedgerEntry): Promise<void> {
        const { guildId, discordId } = entry;
        try {
            const member = await this.deps.adapter.nicknameOf(guildId, discordId);
            if (member && member.nick === entry.appliedNick) {
                await this.deps.adapter.setNickname(guildId, discordId, entry.originalNick);
            }
        } catch (err) {
            logger.error(
                logModules.Discord,
                `Guild ${guildId}, member ${discordId}: could not restore the nickname`,
                err,
            );
            // Any other failure keeps the row so the next lobby, session end or recover tries again.
            if (!isMemberGone(err)) return;
        }
        await this.deps.ledger.remove(guildId, discordId);
    }
}
