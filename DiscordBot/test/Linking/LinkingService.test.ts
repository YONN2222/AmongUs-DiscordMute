import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/Data/Database";
import { relinkFromRoster } from "../../src/Game/AutoRelink";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { BlockedUserError, LinkingService } from "../../src/Linking/LinkingService";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../Helpers/TestDatabase";

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

        describe("blocked users", () => {
            let blocked: LinkingService;
            let blockedId: string;

            beforeEach(() => {
                blockedId = uniqueId("blocked");
                blocked = new LinkingService(
                    db,
                    undefined,
                    new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds }),
                );
            });

            const block = () =>
                db.blocks.create({ type: "user", targetId: blockedId, reason: "test", blockedBy: "admin" });

            it("blocked user cannot create a link code", async () => {
                await block();

                await expect(blocked.createPendingLink(guildId, blockedId)).rejects.toBeInstanceOf(BlockedUserError);
                expect(await db.pendingLinks.getActive(guildId, blockedId, Date.now())).toBeNull();
            });

            it("blocked user's pending code does not confirm", async () => {
                const codes = await blocked.createPendingLink(guildId, blockedId);
                await block();

                expect(await blocked.confirmLink(guildId, codes.phrase, "Crew")).toBeNull();
                expect(await db.links.get(guildId, blockedId)).toBeNull();
                await db.blocks.remove("user", blockedId);
                expect(await blocked.confirmLink(guildId, codes.phrase, "Crew")).toBeNull();
            });

            it("admin cannot force link a blocked user", async () => {
                await block();

                await expect(blocked.forceLink(guildId, blockedId, "Crew", "admin")).rejects.toBeInstanceOf(
                    BlockedUserError,
                );
                expect(await db.links.get(guildId, blockedId)).toBeNull();
            });

            it("admin can still unlink a blocked user", async () => {
                await db.links.upsert(guildId, blockedId, "Crew");
                await block();

                expect(await blocked.removeLink(guildId, blockedId, "admin")).toBe(true);
                expect(await db.links.get(guildId, blockedId)).toBeNull();
            });

            it("users that are not blocked link as before", async () => {
                const codes = await blocked.createPendingLink(guildId, "u1");

                expect(await blocked.confirmLink(guildId, codes.phrase, "Crew")).toMatchObject({ discordId: "u1" });
            });
        });

        it("createPendingLink returns same codes while active", async () => {
            const first = await service.createPendingLink(guildId, "u1");
            const second = await service.createPendingLink(guildId, "u1");
            expect(second).toEqual(first);
        });

        it("confirmLink stores link and returns interaction data", async () => {
            const codes = await service.createPendingLink(guildId, "u1");
            await service.attachInteractionResponse(guildId, "u1", "app", "token");

            const confirmed = await service.confirmLink(guildId, codes.phrase, "Crew");
            expect(confirmed).toEqual({
                guildId,
                discordId: "u1",
                accountName: "Crew",
                applicationId: "app",
                interactionToken: "token",
            });
            expect(await service.getLink(guildId, "u1")).toMatchObject({ accountName: "Crew" });
            expect(await service.confirmLink(guildId, codes.phrase, "Crew")).toBeNull();
        });

        it("confirmLink returns the locale stored with the interaction", async () => {
            const codes = await service.createPendingLink(guildId, "u1");
            await service.attachInteractionResponse(guildId, "u1", "app", "token", "de");

            expect(await service.confirmLink(guildId, codes.phrase, "Crew")).toMatchObject({ locale: "de" });
        });

        it("confirmLink stores a non-empty friend code and ignores an empty one", async () => {
            const first = await service.createPendingLink(guildId, "u1");
            await service.confirmLink(guildId, first.phrase, "Crew", "crew#1234");
            expect(await db.links.get(guildId, "u1")).toMatchObject({ friendCode: "crew#1234" });

            const second = await service.createPendingLink(guildId, "u2");
            await service.confirmLink(guildId, second.phrase, "Blue", "");
            expect(await db.links.get(guildId, "u2")).toMatchObject({ friendCode: null });
        });

        it("a force-link to another account drops the old friend code so a later roster does not relink it", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.setFriendCode(guildId, "u1", "red#1");

            await service.forceLink(guildId, "u1", "Blue", "admin");

            expect(await db.links.get(guildId, "u1")).toMatchObject({ accountName: "Blue", friendCode: null });
            const roster = [{ name: "Red", friendCode: "red#1", dead: false, disconnected: false }];
            expect(await relinkFromRoster({ links: db.links, events: { emit: () => {} } }, guildId, roster)).toBe(0);
            expect((await db.links.get(guildId, "u1"))?.accountName).toBe("Blue");
        });

        it("confirmLink does not accept a code of another guild", async () => {
            const otherGuild = uniqueId("other");
            const codes = await service.createPendingLink(otherGuild, "u1");

            expect(await service.confirmLink(guildId, codes.phrase, "Attacker")).toBeNull();
            expect(await service.confirmLink(guildId, codes.quickChatCode, "Attacker")).toBeNull();
            expect(await db.links.get(otherGuild, "u1")).toBeNull();
            expect(await service.confirmLink(otherGuild, codes.quickChatCode, "Crew")).toMatchObject({
                guildId: otherGuild,
                discordId: "u1",
            });
        });

        it("confirmLink accepts the quick chat code", async () => {
            const codes = await service.createPendingLink(guildId, "u1");
            expect(await service.confirmLink(guildId, codes.quickChatCode, "Crew")).not.toBeNull();
        });
    });
});
