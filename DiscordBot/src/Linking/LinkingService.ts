import { UniqueConstraintError } from "sequelize";
import type { Database } from "../Data/Database";
import type { LinkEntry as StoredLink } from "../Data/Repositories/LinkRepository";
import type { GuildEventSink } from "../Events/GuildEvents";
import type { BlockChecker } from "../Hosted/BlockChecker";
import type { Locale } from "../I18n/Index";
import { logger, logModules } from "../Logging/Logger";
import { describePhrase, formatQuickChatCode, pickQuickChatPhrases } from "./QuickChatCatalog";

const PENDING_TTL_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const LINK_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateLinkCode(): string {
    let code = "link-";
    for (let i = 0; i < 4; i++) {
        code += LINK_CODE_CHARS[Math.floor(Math.random() * LINK_CODE_CHARS.length)];
    }
    return code;
}

interface LinkEntry {
    discordId: string;
    accountName: string;
    linkedAt: string;
}

interface ConfirmedLink {
    guildId: string;
    discordId: string;
    accountName: string;
    applicationId?: string;
    interactionToken?: string;
    locale?: Locale;
}

interface PendingLinkCodes {
    phrase: string;
    quickChatCode: string;
    quickChatLabels: [string, string];
}

function toEntry(row: StoredLink): LinkEntry {
    return { discordId: row.discordId, accountName: row.accountName, linkedAt: row.linkedAt };
}

const HISTORY_WINDOW = 5;

/** A blocked user may not create or receive links; existing links keep working so they are still muted. */
export class BlockedUserError extends Error {
    constructor(readonly discordId: string) {
        super(`User ${discordId} is blocked`);
        this.name = "BlockedUserError";
    }
}

export class LinkingService {
    private readonly recentPhrases: string[] = [];
    private readonly recentQuickChatCodes = new Set<string>();

    constructor(
        private readonly db: Database,
        private readonly events?: GuildEventSink,
        private readonly blocks?: Pick<BlockChecker, "isUserBlocked">,
    ) {}

    private async assertNotBlocked(discordId: string): Promise<void> {
        if (await this.blocks?.isUserBlocked(discordId)) throw new BlockedUserError(discordId);
    }

    private pickPhrase(): string {
        let code: string;
        do {
            code = generateLinkCode();
        } while (this.recentPhrases.includes(code));
        this.recentPhrases.push(code);
        if (this.recentPhrases.length > HISTORY_WINDOW) this.recentPhrases.shift();
        return code;
    }

    private pickQuickChat(): { code: string; ids: [number, number]; labels: [string, string] } {
        const phrases = pickQuickChatPhrases(2, this.recentQuickChatCodes);
        const ids = phrases.map((p) => p.id) as [number, number];
        const code = formatQuickChatCode(ids);

        this.recentQuickChatCodes.add(code);
        if (this.recentQuickChatCodes.size > HISTORY_WINDOW) {
            const oldest = this.recentQuickChatCodes.values().next().value;
            if (oldest !== undefined) this.recentQuickChatCodes.delete(oldest);
        }

        return { code, ids, labels: [describePhrase(ids[0]), describePhrase(ids[1])] };
    }

    async createPendingLink(guildId: string, discordId: string): Promise<PendingLinkCodes> {
        await this.assertNotBlocked(discordId);
        const now = Date.now();
        const existing = await this.db.pendingLinks.getActive(guildId, discordId, now);
        if (existing) {
            return {
                phrase: existing.phrase,
                quickChatCode: existing.quickChatCode,
                quickChatLabels: [describePhrase(existing.quickChatIds[0]), describePhrase(existing.quickChatIds[1])],
            };
        }

        await this.db.pendingLinks.deleteExpired(now);

        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            const phrase = this.pickPhrase();
            const quickChat = this.pickQuickChat();
            try {
                await this.db.pendingLinks.create({
                    guildId,
                    discordId,
                    phrase,
                    quickChatCode: quickChat.code,
                    quickChatIds: quickChat.ids,
                    expiresAt: now + PENDING_TTL_MS,
                });
            } catch (error) {
                if (error instanceof UniqueConstraintError) continue;
                throw error;
            }
            logger.debug(
                logModules.Command,
                `Pending link created for ${discordId} in guild ${guildId}: "${phrase}" / quick chat "${quickChat.code}"`,
            );
            return { phrase, quickChatCode: quickChat.code, quickChatLabels: quickChat.labels };
        }
        throw new Error("Could not generate a unique link code");
    }

    async attachInteractionResponse(
        guildId: string,
        discordId: string,
        applicationId: string,
        interactionToken: string,
        locale?: Locale,
    ): Promise<void> {
        await this.db.pendingLinks.attachInteraction(guildId, discordId, applicationId, interactionToken, locale);
    }

    /** Only codes of the plugin's own guild match, so one server can never confirm another server's link. */
    async confirmLink(
        guildId: string,
        code: string,
        accountName: string,
        friendCode?: string,
    ): Promise<ConfirmedLink | null> {
        const matched = await this.db.pendingLinks.consumeByCode(guildId, code, Date.now());
        if (!matched) return null;
        // The code is already consumed, so a blocked user's code cannot be used later either.
        if (await this.blocks?.isUserBlocked(matched.discordId)) return null;

        await this.db.links.upsert(matched.guildId, matched.discordId, accountName);
        if (friendCode) await this.db.links.setFriendCode(matched.guildId, matched.discordId, friendCode);
        logger.info(
            logModules.Command,
            `Linked Discord ${matched.discordId} -> Among Us "${accountName}" in guild ${matched.guildId}`,
        );

        return {
            guildId: matched.guildId,
            discordId: matched.discordId,
            accountName,
            applicationId: matched.applicationId,
            interactionToken: matched.interactionToken,
            locale: matched.locale,
        };
    }

    async forceLink(guildId: string, discordId: string, accountName: string, actorId: string): Promise<void> {
        await this.assertNotBlocked(discordId);
        const previous = await this.db.links.get(guildId, discordId);
        await this.db.links.upsert(guildId, discordId, accountName);
        logger.info(
            logModules.Command,
            `Force Linked Discord ${discordId} -> Among Us "${accountName}" in guild ${guildId}`,
        );
        this.events?.emit({
            type: "link-changed",
            guildId,
            discordId,
            change: "force-linked",
            accountName,
            actorId,
            ...(previous ? { previousName: previous.accountName } : {}),
        });
    }

    async removeLink(guildId: string, discordId: string, actorId: string): Promise<boolean> {
        const previous = await this.db.links.get(guildId, discordId);
        const deleted = await this.db.links.remove(guildId, discordId);
        if (deleted) {
            logger.info(logModules.Command, `Unlinked Discord ${discordId} in guild ${guildId}`);
            this.events?.emit({
                type: "link-changed",
                guildId,
                discordId,
                change: "unlinked",
                actorId,
                ...(previous ? { previousName: previous.accountName } : {}),
            });
        }
        return deleted;
    }

    countLinks(guildId: string): Promise<number> {
        return this.db.links.countByGuild(guildId);
    }

    async listLinkPage(guildId: string, offset: number, limit: number): Promise<StoredLink[]> {
        return this.db.links.listPage(guildId, offset, limit);
    }

    async getLink(guildId: string, discordId: string): Promise<LinkEntry | undefined> {
        const row = await this.db.links.get(guildId, discordId);
        return row ? toEntry(row) : undefined;
    }

    async getAllLinks(guildId: string): Promise<LinkEntry[]> {
        const rows = await this.db.links.listByGuild(guildId);
        return rows.map(toEntry);
    }
}
