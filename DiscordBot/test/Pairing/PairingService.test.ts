import { UniqueConstraintError } from "sequelize";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import { hashSecret } from "../../src/Gateway/GuildSecrets";
import { describePhrase, formatQuickChatCode, QUICK_CHAT_CATALOG } from "../../src/Linking/QuickChatCatalog";
import { PAIRING_CODE_TTL_MS, PairingService } from "../../src/Pairing/PairingService";
import { createTestDatabase } from "../Helpers/TestDatabase";

const GUILD = "guild-1";
const NOW = 1_000_000;

/** The code the host would send for the phrases shown in /setup. */
function codeOf(phrases: string[]): string {
    const ids = phrases.map((label) => QUICK_CHAT_CATALOG.find((phrase) => describePhrase(phrase.id) === label)?.id);
    return formatQuickChatCode(ids as number[]);
}

describe("PairingService", () => {
    let db: Database;
    let service: PairingService;

    beforeEach(async () => {
        db = await createTestDatabase();
        service = new PairingService(db);
    });

    afterEach(async () => {
        await db.close();
        vi.restoreAllMocks();
    });

    it("issues three distinct catalog phrases valid for ten minutes", async () => {
        const issued = await service.createCode(GUILD, "Guild", NOW);

        expect(new Set(issued.phrases).size).toBe(3);
        expect(issued.expiresAt).toBe(NOW + PAIRING_CODE_TTL_MS);
    });

    it("pairs with the code once and creates a token that resolves to the guild", async () => {
        const issued = await service.createCode(GUILD, "Guild", NOW);

        const paired = await service.pair(codeOf(issued.phrases), "android", NOW + 1);
        expect(paired).toEqual({ guildId: GUILD, guildName: "Guild", secret: expect.stringMatching(/^dmh_/) });
        expect(await db.deviceTokens.use(hashSecret(paired?.secret ?? ""), NOW + 2)).toBe(GUILD);
        expect((await db.deviceTokens.list(GUILD, 10))[0]?.platform).toBe("android");

        expect(await service.pair(codeOf(issued.phrases), "android", NOW + 3)).toBeNull();
    });

    it("refuses an expired or unknown code", async () => {
        const issued = await service.createCode(GUILD, "Guild", NOW);

        expect(await service.pair("1-2-3", "android", NOW)).toBeNull();
        expect(await service.pair(codeOf(issued.phrases), "android", NOW + PAIRING_CODE_TTL_MS)).toBeNull();
        expect(await db.deviceTokens.list(GUILD, 10)).toEqual([]);
    });

    it("a new code replaces the previous one of the guild", async () => {
        const first = await service.createCode(GUILD, "Guild", NOW);
        const second = await service.createCode(GUILD, "Guild", NOW);

        if (codeOf(first.phrases) !== codeOf(second.phrases)) {
            expect(await service.pair(codeOf(first.phrases), "windows", NOW)).toBeNull();
        }
        expect(await service.pair(codeOf(second.phrases), "windows", NOW)).not.toBeNull();
    });

    it("tries another code when one is taken by another guild and gives up after a few tries", async () => {
        const replace = vi.spyOn(db.pairingCodes, "replace").mockRejectedValueOnce(new UniqueConstraintError({}));
        await service.createCode(GUILD, "Guild", NOW);
        expect(replace).toHaveBeenCalledTimes(2);

        replace.mockRejectedValue(new UniqueConstraintError({}));
        await expect(service.createCode(GUILD, "Guild", NOW)).rejects.toThrow(/free pairing code/);
    });

    it("deletes expired codes before issuing a new one", async () => {
        await db.pairingCodes.replace({ guildId: "old", guildName: "Old", code: "1-2-3", expiresAt: NOW - 1 });
        await service.createCode(GUILD, "Guild", NOW);

        expect(await db.pairingCodes.consume("1-2-3", 0)).toBeNull();
    });
});
