import { accountNameKeys, normalizeAccountName } from "../Data/AccountNameMatch";
import type { LinkRepository } from "../Data/Repositories/LinkRepository";
import type { NicknameLedgerEntry, NicknameLedgerRepository } from "../Data/Repositories/NicknameLedgerRepository";
import type { GuildEvent, GuildEventBus } from "../Events/GuildEvents";
import { logger, logModules } from "../Logging/Logger";
import type { SettingsService } from "../Settings/SettingsService";
import { ActiveSessions } from "../Utils/ActiveSessions";
import { GuildQueue } from "../Utils/GuildQueue";
import { LeavingGuilds } from "../Utils/LeavingGuilds";

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

/** One member a game wants to show under their Among Us name. */
interface Rename {
    guildId: string;
    sessionId: string;
    discordId: string;
    nick: string;
    channelIds: string[];
}

function truncate(name: string): string {
    return [...name].slice(0, MAX_NICKNAME_LENGTH).join("");
}

/**
 * Shows the Among Us name as server nickname while a game runs and puts the old nickname back afterwards. Several
 * games can run in one guild; the ledger records which session renamed a member last, and only that session (or
 * nobody, once it ended) puts the nickname back.
 */
export class NicknameSync {
    private readonly queue = new GuildQueue();
    /** Sessions that already reported a member who cannot be renamed. */
    private readonly reportedGames = new Set<string>();
    /** The sessions per guild that renamed members in their running game. */
    private readonly activeSessions = new ActiveSessions();
    /** Guilds the bot is leaving; nobody is renamed there until the leave returned. */
    private readonly leavingGuilds = new LeavingGuilds();

    constructor(private readonly deps: NicknameSyncDeps) {}

    handle(event: GuildEvent): Promise<void> {
        if (this.leavingGuilds.has(event.guildId)) return Promise.resolve();
        // session-ended is restored by the cluster request handler, which awaits it before the cluster can stop.
        if (event.type === "game-event" && event.event === "lobby") {
            return this.restoreSession(event.guildId, event.sessionId);
        }
        if (event.type !== "game-event" || event.event !== "game-start") return Promise.resolve();
        const { guildId, sessionId } = event;
        return this.queue.run(guildId, async () => {
            if (!(await this.deps.settings.get(guildId)).nicknameSync) return;
            this.activeSessions.add(guildId, sessionId);
            await this.applyNames(guildId, sessionId, event.players, event.channelIds);
        });
    }

    /** Puts back the nicknames of this session and those no running session owns any more. */
    restoreSession(guildId: string, sessionId: string): Promise<void> {
        return this.queue.run(guildId, async () => {
            this.reportedGames.delete(sessionId);
            this.activeSessions.delete(guildId, sessionId);
            for (const entry of await this.deps.ledger.listByGuild(guildId)) {
                if (!this.activeSessions.has(guildId, entry.sessionId)) await this.restoreOne(entry);
            }
        });
    }

    /** Runs on cluster ready and when a guild adds the bot back, so nicknames left behind are put back. */
    async recover(guildIds: string[]): Promise<void> {
        const guilds = new Set((await this.deps.ledger.listByGuilds(guildIds)).map((entry) => entry.guildId));
        await Promise.all([...guilds].map((guildId) => this.restoreGuild(guildId)));
    }

    /**
     * Puts back every nickname of the guild before the bot leaves it, because its ledger is purged afterwards.
     * Game events of the guild are ignored until reopenGuild.
     */
    endGuild(guildId: string): Promise<void> {
        this.leavingGuilds.enter(guildId);
        return this.restoreGuild(guildId);
    }

    /** Called once the leave returned; if the bot is still in the guild, new games rename again. */
    reopenGuild(guildId: string): void {
        this.leavingGuilds.exit(guildId);
    }

    /** The guild removed the bot: forgets its games and keeps the ledger, which recover puts back later. */
    forgetGuild(guildId: string): void {
        this.forgetSessionsOf(guildId);
    }

    /** Forgets every game running in the guild and puts back every nickname on record there. */
    private restoreGuild(guildId: string): Promise<void> {
        return this.queue.run(guildId, async () => {
            this.forgetSessionsOf(guildId);
            for (const entry of await this.deps.ledger.listByGuild(guildId)) await this.restoreOne(entry);
        });
    }

    private forgetSessionsOf(guildId: string): void {
        for (const sessionId of this.activeSessions.of(guildId)) {
            this.reportedGames.delete(sessionId);
            this.activeSessions.delete(guildId, sessionId);
        }
    }

    private async applyNames(
        guildId: string,
        sessionId: string,
        players: string[],
        channelIds: string[],
    ): Promise<void> {
        if (channelIds.length === 0) return;
        const targets = await this.resolveTargets(guildId, players);
        const ledger = new Map((await this.deps.ledger.listByGuild(guildId)).map((entry) => [entry.discordId, entry]));
        for (const [discordId, nick] of targets) {
            try {
                await this.applyOne({ guildId, sessionId, discordId, nick, channelIds }, ledger.get(discordId));
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

    private async applyOne(rename: Rename, previous: NicknameLedgerEntry | undefined): Promise<void> {
        const { guildId, sessionId, discordId, nick, channelIds } = rename;
        const channelId = await this.deps.adapter.voiceChannelOf(guildId, discordId);
        if (channelId === null || !channelIds.includes(channelId)) return;
        const member = await this.deps.adapter.nicknameOf(guildId, discordId);
        if (!member) return;
        if (member.nick === nick) {
            await this.takeOver(rename, previous);
            return;
        }

        // Only a nickname the bot set itself can be put back, so a changed one never overwrites the real original.
        const originalNick = previous && previous.appliedNick === member.nick ? previous.originalNick : member.nick;
        await this.deps.ledger.set(guildId, discordId, originalNick, nick, sessionId);
        try {
            await this.deps.adapter.setNickname(guildId, discordId, nick);
        } catch (err) {
            await this.revertLedger(guildId, discordId, previous);
            if (!isMissingPermission(err)) throw err;
            logger.warn(logModules.Discord, `Guild ${guildId}, member ${discordId}: nickname cannot be changed`);
            this.reportNotEditable(guildId, sessionId, discordId);
        }
    }

    /** Another game already gave the member this name; the game that touched them last puts the old one back. */
    private async takeOver(rename: Rename, previous: NicknameLedgerEntry | undefined): Promise<void> {
        if (!previous || previous.appliedNick !== rename.nick || previous.sessionId === rename.sessionId) return;
        const { guildId, sessionId, discordId, nick } = rename;
        await this.deps.ledger.set(guildId, discordId, previous.originalNick, nick, sessionId);
    }

    private reportNotEditable(guildId: string, sessionId: string, discordId: string): void {
        if (this.reportedGames.has(sessionId)) return;
        this.reportedGames.add(sessionId);
        this.deps.events.emit({ type: "voice-error", guildId, code: "member-not-editable", discordId });
    }

    private async revertLedger(
        guildId: string,
        discordId: string,
        previous: NicknameLedgerEntry | undefined,
    ): Promise<void> {
        try {
            if (previous) {
                const { originalNick, appliedNick, sessionId } = previous;
                await this.deps.ledger.set(guildId, discordId, originalNick, appliedNick, sessionId);
            } else {
                await this.deps.ledger.remove(guildId, discordId);
            }
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
