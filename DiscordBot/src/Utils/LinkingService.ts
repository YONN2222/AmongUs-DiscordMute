import { logger, logModules } from "../Logging/logger";
import { LinkModel } from "../Models/LinkModel";
import { sequelize } from "../Models/sequelize";
import { describePhrase, formatQuickChatCode, pickQuickChatPhrases } from "./QuickChatCatalog";

const PENDING_TTL_MS = 5 * 60 * 1000;

const LINK_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateLinkCode(): string {
    let code = "link-";
    for (let i = 0; i < 4; i++) {
        code += LINK_CODE_CHARS[Math.floor(Math.random() * LINK_CODE_CHARS.length)];
    }
    return code;
}

function pendingKey(guildId: string, discordId: string): string {
    return `${guildId}:${discordId}`;
}

interface PendingLink {
    guildId: string;
    discordId: string;
    phrase: string;
    quickChatCode: string;
    quickChatIds: [number, number];
    expiresAt: number;
    applicationId?: string;
    interactionToken?: string;
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
}

interface PendingLinkCodes {
    phrase: string;
    quickChatCode: string;
    quickChatLabels: [string, string];
}

function toEntry(row: LinkModel): LinkEntry {
    return { discordId: row.discordId, accountName: row.accountName, linkedAt: row.linkedAt };
}

const HISTORY_WINDOW = 5;

class LinkingService {
    private readonly pending = new Map<string, PendingLink>();
    private readonly recentPhrases: string[] = [];
    private readonly recentQuickChatCodes = new Set<string>();

    async init(): Promise<void> {
        await sequelize.sync();
        logger.success(logModules.Database, "Database is ready!");
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

    createPendingLink(guildId: string, discordId: string): PendingLinkCodes {
        const key = pendingKey(guildId, discordId);
        const existing = this.pending.get(key);
        if (existing && existing.expiresAt > Date.now()) {
            return {
                phrase: existing.phrase,
                quickChatCode: existing.quickChatCode,
                quickChatLabels: [describePhrase(existing.quickChatIds[0]), describePhrase(existing.quickChatIds[1])],
            };
        }

        const phrase = this.pickPhrase();
        const quickChat = this.pickQuickChat();
        this.pending.set(key, {
            guildId,
            discordId,
            phrase,
            quickChatCode: quickChat.code,
            quickChatIds: quickChat.ids,
            expiresAt: Date.now() + PENDING_TTL_MS,
        });
        logger.debug(
            logModules.Command,
            `Pending link created for ${discordId} in guild ${guildId}: "${phrase}" / quick chat "${quickChat.code}"`,
        );
        return { phrase, quickChatCode: quickChat.code, quickChatLabels: quickChat.labels };
    }

    attachInteractionResponse(
        guildId: string,
        discordId: string,
        applicationId: string,
        interactionToken: string,
    ): void {
        const key = pendingKey(guildId, discordId);
        const existing = this.pending.get(key);
        if (!existing) return;

        this.pending.set(key, { ...existing, applicationId, interactionToken });
    }

    private async upsertLink(guildId: string, discordId: string, accountName: string): Promise<void> {
        await LinkModel.upsert({
            guildId,
            discordId,
            accountName,
            linkedAt: new Date().toISOString(),
        });
    }

    async confirmLink(phrase: string, accountName: string): Promise<ConfirmedLink | null> {
        const now = Date.now();
        let matched: PendingLink | undefined;

        for (const entry of this.pending.values()) {
            if ((entry.phrase === phrase || entry.quickChatCode === phrase) && entry.expiresAt > now) {
                matched = entry;
                break;
            }
        }

        if (!matched) return null;

        this.pending.delete(pendingKey(matched.guildId, matched.discordId));
        await this.upsertLink(matched.guildId, matched.discordId, accountName);
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
        };
    }

    async forceLink(guildId: string, discordId: string, accountName: string): Promise<void> {
        await this.upsertLink(guildId, discordId, accountName);
        logger.info(
            logModules.Command,
            `Force Linked Discord ${discordId} -> Among Us "${accountName}" in guild ${guildId}`,
        );
    }

    async removeLink(guildId: string, discordId: string): Promise<boolean> {
        const deleted = await LinkModel.destroy({ where: { guildId, discordId } });
        if (deleted > 0) {
            logger.info(logModules.Command, `Unlinked Discord ${discordId} in guild ${guildId}`);
        }
        return deleted > 0;
    }

    async getLink(guildId: string, discordId: string): Promise<LinkEntry | undefined> {
        const row = await LinkModel.findOne({ where: { guildId, discordId } });
        return row ? toEntry(row) : undefined;
    }

    async getAllLinks(guildId: string): Promise<LinkEntry[]> {
        const rows = await LinkModel.findAll({ where: { guildId } });
        return rows.map(toEntry);
    }
}

export const linkingService = new LinkingService();
