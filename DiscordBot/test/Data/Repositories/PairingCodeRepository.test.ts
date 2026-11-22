import { UniqueConstraintError } from "sequelize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../../src/Data/Database";
import type { PairingCodeModel } from "../../../src/Data/Models/PairingCodeModel";
import { createPairingCodeRepository, type PairingCode } from "../../../src/Data/Repositories/PairingCodeRepository";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../../Helpers/TestDatabase";

describe("createPairingCodeRepository", () => {
    it("refuses a model that was never initialised", () => {
        expect(() => createPairingCodeRepository({} as typeof PairingCodeModel)).toThrow(/not initialised/);
    });
});

describe.each(backends)("PairingCodeRepository (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;
        const now = 1_000_000;

        function pairing(overrides: Partial<PairingCode> = {}): PairingCode {
            return { guildId, guildName: "Guild", code: uniqueId("code"), expiresAt: now + 60_000, ...overrides };
        }

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("g");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("consume returns the pairing once and then forgets it", async () => {
            const p = pairing();
            await db.pairingCodes.replace(p);

            expect(await db.pairingCodes.consume(p.code, now)).toEqual(p);
            expect(await db.pairingCodes.consume(p.code, now)).toBeNull();
        });

        it("only one of two parallel consumes wins", async () => {
            const p = pairing();
            await db.pairingCodes.replace(p);

            const results = await Promise.all([
                db.pairingCodes.consume(p.code, now),
                db.pairingCodes.consume(p.code, now),
            ]);
            expect(results.filter((result) => result !== null)).toHaveLength(1);
        });

        it("consume ignores an expired code", async () => {
            const p = pairing({ expiresAt: now });
            await db.pairingCodes.replace(p);

            expect(await db.pairingCodes.consume(p.code, now)).toBeNull();
        });

        it("a new code replaces the guild's previous one", async () => {
            const first = pairing();
            const second = pairing();
            await db.pairingCodes.replace(first);
            await db.pairingCodes.replace(second);

            expect(await db.pairingCodes.consume(first.code, now)).toBeNull();
            expect(await db.pairingCodes.consume(second.code, now)).toEqual(second);
        });

        it("refuses a code another guild holds", async () => {
            const p = pairing();
            await db.pairingCodes.replace(p);

            await expect(
                db.pairingCodes.replace(pairing({ guildId: uniqueId("other"), code: p.code })),
            ).rejects.toThrow(UniqueConstraintError);
            expect(await db.pairingCodes.consume(p.code, now)).toEqual(p);
        });

        it("deleteExpired removes only expired codes", async () => {
            const fresh = pairing();
            await db.pairingCodes.replace(pairing({ guildId: uniqueId("old"), expiresAt: now - 1 }));
            await db.pairingCodes.replace(fresh);

            expect(await db.pairingCodes.deleteExpired(now)).toBeGreaterThanOrEqual(1);
            expect(await db.pairingCodes.consume(fresh.code, now)).toEqual(fresh);
        });
    });
});
