import { DiscordAPIError } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { MessagePort } from "../../src/Cluster/MessagePort";
import type { TrackedMessage } from "../../src/Data/Repositories/TrackedMessageRepository";
import { sweepTrackedMessages } from "../../src/Game/TrackedMessageSweeper";
import { logger } from "../../src/Logging/Logger";

const GUILD = "1200000000000000001";
const NOW = 1_000_000;

const row = (key: string, deleteAt: number | null): TrackedMessage => ({
    guildId: GUILD,
    kind: "summary",
    key,
    channelId: "c1",
    messageId: `m-${key}`,
    deleteAt,
});

function setup(rows: TrackedMessage[], deleteImpl: MessagePort["delete"] = async () => {}) {
    const store = [...rows];
    const port = { delete: vi.fn<MessagePort["delete"]>(deleteImpl) };
    const tracked = {
        listDue: vi.fn(async (_guilds: string[], now: number) =>
            store.filter((r) => r.deleteAt !== null && r.deleteAt <= now),
        ),
        remove: vi.fn(async (_guildId: string, _kind: string, key: string) => {
            const index = store.findIndex((r) => r.key === key);
            if (index >= 0) store.splice(index, 1);
        }),
    };
    return { port, tracked, store };
}

describe("sweepTrackedMessages", () => {
    it("deletes due messages and removes their rows", async () => {
        const { port, tracked, store } = setup([row("due", NOW - 1), row("later", NOW + 1)]);
        await sweepTrackedMessages({ port, tracked }, [GUILD], NOW);
        expect(port.delete).toHaveBeenCalledTimes(1);
        expect(port.delete).toHaveBeenCalledWith("c1", "m-due");
        expect(store.map((r) => r.key)).toEqual(["later"]);
    });

    it("removes the row when the message is already gone", async () => {
        const gone = new DiscordAPIError(
            { code: 10008, message: "Unknown Message" },
            10008,
            404,
            "DELETE",
            "/x",
            {} as never,
        );
        const { port, tracked, store } = setup([row("due", NOW - 1)], () => Promise.reject(gone));
        await sweepTrackedMessages({ port, tracked }, [GUILD], NOW);
        expect(port.delete).toHaveBeenCalledTimes(1);
        expect(store).toEqual([]);
    });

    it("keeps the row for a retry after a server or network failure", async () => {
        vi.spyOn(logger, "warn").mockImplementation(() => {});
        const { tracked, store } = setup([row("due", NOW - 1)]);
        await sweepTrackedMessages(
            { port: { delete: async () => Promise.reject(new Error("offline")) }, tracked },
            [GUILD],
            NOW,
        );
        expect(store).toHaveLength(1);
        vi.restoreAllMocks();
    });
});
