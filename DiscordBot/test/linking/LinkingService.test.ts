import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/database";
import { LinkingService } from "../../src/Utils/LinkingService";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../helpers/testDatabase";

describe.each(backends)("LinkingService (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let service: LinkingService;
        let guildId: string;

        beforeEach(async () => {
            db = await openBackend(backend);
            service = new LinkingService(db);
            guildId = uniqueId("g");
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("createPendingLink returns same codes while active", async () => {
            const first = await service.createPendingLink(guildId, "u1");
            const second = await service.createPendingLink(guildId, "u1");
            expect(second).toEqual(first);
        });

        it("confirmLink stores link and returns interaction data", async () => {
            const codes = await service.createPendingLink(guildId, "u1");
            await service.attachInteractionResponse(guildId, "u1", "app", "token");

            const confirmed = await service.confirmLink(codes.phrase, "Crew");
            expect(confirmed).toEqual({
                guildId,
                discordId: "u1",
                accountName: "Crew",
                applicationId: "app",
                interactionToken: "token",
            });
            expect(await service.getLink(guildId, "u1")).toMatchObject({ accountName: "Crew" });
            expect(await service.confirmLink(codes.phrase, "Crew")).toBeNull();
        });

        it("confirmLink accepts the quick chat code", async () => {
            const codes = await service.createPendingLink(guildId, "u1");
            expect(await service.confirmLink(codes.quickChatCode, "Crew")).not.toBeNull();
        });
    });
});
