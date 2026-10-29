import { UniqueConstraintError } from "sequelize";
import type { Database } from "../Data/database";
import type { LinkEntry as StoredLink } from "../Data/repositories/LinkRepository";
import type { Locale } from "../i18n";
import { logger, logModules } from "../Logging/logger";
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

export class LinkingService {
    private readonly recentPhrases: string[] = [];
    private readonly recentQuickChatCodes = new Set<string>();

    constructor(private readonly db: Database) {}

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

    async confirmLink(code: string, accountName: string): Promise<ConfirmedLink | null> {
        const matched = await this.db.pendingLinks.consumeByCode(code, Date.now());
        if (!matched) return null;

        await this.db.links.upsert(matched.guildId, matched.discordId, accountName);
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

    async forceLink(guildId: string, discordId: string, accountName: string): Promise<void> {
        await this.db.links.upsert(guildId, discordId, accountName);
        logger.info(
            logModules.Command,
            `Force Linked Discord ${discordId} -> Among Us "${accountName}" in guild ${guildId}`,
        );
    }

    async removeLink(guildId: string, discordId: string): Promise<boolean> {
        const deleted = await this.db.links.remove(guildId, discordId);
        if (deleted) {
            logger.info(logModules.Command, `Unlinked Discord ${discordId} in guild ${guildId}`);
        }
        return deleted;
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
