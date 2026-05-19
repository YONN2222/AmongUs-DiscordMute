import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { logger, logModules } from "../Logging/logger";

const LINKING_PATH = "./linking.json";
const PENDING_TTL_MS = 5 * 60 * 1000;

const LINK_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateLinkCode(): string {
    let code = "link-";
    for (let i = 0; i < 4; i++) {
        code += LINK_CODE_CHARS[Math.floor(Math.random() * LINK_CODE_CHARS.length)];
    }
    return code;
}

interface PendingLink {
    discordId: string;
    phrase: string;
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
    discordId: string;
    accountName: string;
    applicationId?: string;
    interactionToken?: string;
}

interface LinkingData {
    links: LinkEntry[];
}

const HISTORY_WINDOW = 5;

class LinkingService {
    private readonly pending = new Map<string, PendingLink>();
    private readonly recentPhrases: string[] = [];

    private loadData(): LinkingData {
        if (!existsSync(LINKING_PATH)) return { links: [] };
        try {
            return JSON.parse(readFileSync(LINKING_PATH, "utf-8")) as LinkingData;
        } catch {
            return { links: [] };
        }
    }

    private saveData(data: LinkingData): void {
        writeFileSync(LINKING_PATH, JSON.stringify(data, null, 2), "utf-8");
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

    createPendingLink(discordId: string): string {
        const existing = this.pending.get(discordId);
        if (existing && existing.expiresAt > Date.now()) return existing.phrase;

        const phrase = this.pickPhrase();
        this.pending.set(discordId, { discordId, phrase, expiresAt: Date.now() + PENDING_TTL_MS });
        logger.debug(logModules.Command, `Pending link created for ${discordId}: "${phrase}"`);
        return phrase;
    }

    attachInteractionResponse(discordId: string, applicationId: string, interactionToken: string): void {
        const existing = this.pending.get(discordId);
        if (!existing) return;

        this.pending.set(discordId, {
            ...existing,
            applicationId,
            interactionToken,
        });
    }

    confirmLink(phrase: string, accountName: string): ConfirmedLink | null {
        const now = Date.now();
        let matched: PendingLink | undefined;

        for (const entry of this.pending.values()) {
            if (entry.phrase === phrase && entry.expiresAt > now) {
                matched = entry;
                break;
            }
        }

        if (!matched) return null;

        this.pending.delete(matched.discordId);

        const data = this.loadData();
        const existing = data.links.findIndex((l) => l.discordId === matched.discordId);
        const newEntry: LinkEntry = { discordId: matched.discordId, accountName, linkedAt: new Date().toISOString() };

        if (existing >= 0) {
            data.links[existing] = newEntry;
        } else {
            data.links.push(newEntry);
        }

        this.saveData(data);
        logger.info(logModules.Command, `Linked Discord ${matched.discordId} → Among Us "${accountName}"`);
        return {
            discordId: matched.discordId,
            accountName,
            applicationId: matched.applicationId,
            interactionToken: matched.interactionToken,
        };
    }

    forceLink(discordId: string, accountName: string): void {
        const data = this.loadData();
        const existing = data.links.findIndex((l) => l.discordId === discordId);
        const newEntry: LinkEntry = { discordId, accountName, linkedAt: new Date().toISOString() };

        if (existing >= 0) {
            data.links[existing] = newEntry;
        } else {
            data.links.push(newEntry);
        }

        this.saveData(data);
        logger.info(logModules.Command, `Force Linked Discord ${discordId} → Among Us "${accountName}"`);
    }

    getLink(discordId: string): LinkEntry | undefined {
        return this.loadData().links.find((l) => l.discordId === discordId);
    }

    getAllLinks(): LinkEntry[] {
        return this.loadData().links;
    }
}

export const linkingService = new LinkingService();
