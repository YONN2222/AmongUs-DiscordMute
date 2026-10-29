import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/Data/database";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { relinkFromRoster } from "../../src/Game/autoRelink";
import type { RosterEntry } from "../../src/Protocol/PluginProtocol";
import { backendAvailable, backends, openBackend, purgeTestRows, uniqueId } from "../helpers/testDatabase";

function player(name: string, friendCode?: string): RosterEntry {
    return { name, ...(friendCode === undefined ? {} : { friendCode }), dead: false, disconnected: false };
}

describe.each(backends)("relinkFromRoster (%s)", (backend) => {
    describe.skipIf(!backendAvailable(backend))("suite", () => {
        let db: Database;
        let guildId: string;
        let emit: ReturnType<typeof vi.fn<(e: GuildEvent) => void>>;

        const relink = (roster: RosterEntry[]) =>
            relinkFromRoster({ links: db.links, events: { emit } }, guildId, roster);

        beforeEach(async () => {
            db = await openBackend(backend);
            guildId = uniqueId("g");
            emit = vi.fn<(e: GuildEvent) => void>();
        });

        afterEach(async () => {
            await purgeTestRows(db);
            await db.close();
        });

        it("renames a link whose friend code shows up under a new name", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.setFriendCode(guildId, "u1", "abc#1");

            expect(await relink([player("Crimson", "abc#1")])).toBe(1);

            expect(await db.links.get(guildId, "u1")).toMatchObject({ accountName: "Crimson", friendCode: "abc#1" });
            expect(emit).toHaveBeenCalledWith({
                type: "link-changed",
                guildId,
                discordId: "u1",
                change: "relinked",
                accountName: "Crimson",
                previousName: "Red",
            });
        });

        it("does nothing when the same friend code appears twice in the roster", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.setFriendCode(guildId, "u1", "abc#1");

            expect(await relink([player("Crimson", "abc#1"), player("Scarlet", "abc#1")])).toBe(0);

            expect((await db.links.get(guildId, "u1"))?.accountName).toBe("Red");
            expect(emit).not.toHaveBeenCalled();
        });

        it("does nothing when the friend code matches two links", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.upsert(guildId, "u2", "Blue");
            await db.links.setFriendCode(guildId, "u1", "abc#1");
            await db.links.setFriendCode(guildId, "u2", "abc#1");

            expect(await relink([player("Crimson", "abc#1")])).toBe(0);

            expect((await db.links.get(guildId, "u1"))?.accountName).toBe("Red");
            expect((await db.links.get(guildId, "u2"))?.accountName).toBe("Blue");
        });

        it("does nothing for an empty or missing friend code", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.setFriendCode(guildId, "u1", "abc#1");

            expect(await relink([player("Crimson", ""), player("Scarlet")])).toBe(0);

            expect((await db.links.get(guildId, "u1"))?.accountName).toBe("Red");
            expect(emit).not.toHaveBeenCalled();
        });

        it("stores the friend code of a player that matches one link by name", async () => {
            await db.links.upsert(guildId, "u1", "Red");

            expect(await relink([player("Red", "abc#1")])).toBe(0);

            expect(await db.links.get(guildId, "u1")).toMatchObject({ accountName: "Red", friendCode: "abc#1" });
            expect(emit).not.toHaveBeenCalled();
        });

        it("keeps a stored friend code when the name matches", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.setFriendCode(guildId, "u1", "old#1");

            await relink([player("Red", "new#2")]);

            expect((await db.links.get(guildId, "u1"))?.friendCode).toBe("old#1");
        });

        it("does not store a friend code that already belongs to another link", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.upsert(guildId, "u2", "Blue");
            await db.links.setFriendCode(guildId, "u2", "abc#1");

            await relink([player("Red", "abc#1")]);

            expect((await db.links.get(guildId, "u1"))?.friendCode).toBeNull();
        });

        it("does not store a friend code when the name matches several links", async () => {
            await db.links.upsert(guildId, "u1", "Red");
            await db.links.upsert(guildId, "u2", "Clan | Red");

            await relink([player("Red", "abc#1")]);

            expect((await db.links.get(guildId, "u1"))?.friendCode).toBeNull();
            expect((await db.links.get(guildId, "u2"))?.friendCode).toBeNull();
        });
    });
});
