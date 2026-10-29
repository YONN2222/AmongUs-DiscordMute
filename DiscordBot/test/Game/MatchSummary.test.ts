import { describe, expect, it, vi } from "vitest";
import type { MessagePort } from "../../src/Cluster/MessagePort";
import type { TrackedMessage } from "../../src/Data/Repositories/TrackedMessageRepository";
import type { GuildEvent } from "../../src/Events/GuildEvents";
import { MatchSummary } from "../../src/Game/MatchSummary";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";

const GUILD = "1200000000000000001";
const CHANNEL = "1200000000000000010";
const RED_ID = "1300000000000000001";
const SESSION = "s1";

const settingsWith = (channelId: string | null, deleteAfterMinutes = 0): GuildSettings => ({
    ...DEFAULT_SETTINGS,
    summary: { channelId, deleteAfterMinutes },
});

const gameStart: GuildEvent = {
    type: "game-event",
    guildId: GUILD,
    sessionId: SESSION,
    event: "game-start",
    hostAccountName: "Red",
    players: ["Red", "Blue"],
    deadPlayers: [],
    channelIds: [],
};

const gameEnded: GuildEvent = {
    type: "game-ended",
    guildId: GUILD,
    sessionId: SESSION,
    reason: "HumansByTask",
    winners: ["Red"],
    roster: [
        { name: "Red", dead: false, disconnected: false },
        { name: "Blue", dead: true, disconnected: false },
    ],
};

function setup(settings: GuildSettings) {
    let clock = 1_000_000;
    const port = { post: vi.fn<MessagePort["post"]>(async () => "m-1") };
    const upsert = vi.fn(async (_row: TrackedMessage) => {});
    const summary = new MatchSummary({
        port,
        tracked: { upsert },
        links: {
            listByGuild: async (guildId) => [
                {
                    guildId,
                    discordId: RED_ID,
                    accountName: "Red",
                    linkedAt: "2026-01-01T00:00:00.000Z",
                    friendCode: null,
                },
            ],
        },
        settings: { get: async () => settings },
        now: () => clock,
    });
    return { port, upsert, summary, advance: (ms: number) => (clock += ms) };
}

const body = (port: { post: { mock: { calls: unknown[][] } } }) => JSON.stringify(port.post.mock.calls[0][1]);

describe("MatchSummary", () => {
    it("posts the summary with mentions and the game duration", async () => {
        const { port, summary, advance } = setup(settingsWith(CHANNEL));
        await summary.handle(gameStart);
        advance(754_000);
        await summary.handle(gameEnded);
        expect(port.post).toHaveBeenCalledTimes(1);
        expect(port.post.mock.calls[0][0]).toBe(CHANNEL);
        expect(body(port)).toContain(`<@${RED_ID}>`);
        expect(body(port)).toContain("12:34");
    });

    it("omits the duration when the start was not seen", async () => {
        const { port, summary } = setup(settingsWith(CHANNEL));
        await summary.handle(gameEnded);
        expect(body(port)).not.toContain("Duration");
    });

    it("does not reuse a start time for the next game", async () => {
        const { port, summary, advance } = setup(settingsWith(CHANNEL));
        await summary.handle(gameStart);
        advance(1000);
        await summary.handle(gameEnded);
        await summary.handle(gameEnded);
        expect(JSON.stringify(port.post.mock.calls[1][1])).not.toContain("Duration");
    });

    it("tracks the message for deletion after the configured minutes", async () => {
        const { upsert, summary, advance } = setup(settingsWith(CHANNEL, 30));
        advance(0);
        await summary.handle(gameEnded);
        expect(upsert).toHaveBeenCalledTimes(1);
        const row = upsert.mock.calls[0][0];
        expect(row).toMatchObject({ guildId: GUILD, kind: "summary", channelId: CHANNEL, messageId: "m-1" });
        expect(row.deleteAt).toBe(1_000_000 + 1_800_000);
        expect(row.key).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("stores no tracked row when deleteAfterMinutes is 0", async () => {
        const { upsert, summary } = setup(settingsWith(CHANNEL, 0));
        await summary.handle(gameEnded);
        expect(upsert).not.toHaveBeenCalled();
    });

    it("posts nothing without a summary channel", async () => {
        const { port, upsert, summary } = setup(settingsWith(null, 30));
        await summary.handle(gameStart);
        await summary.handle(gameEnded);
        expect(port.post).not.toHaveBeenCalled();
        expect(upsert).not.toHaveBeenCalled();
    });

    it("posts nothing for a v2 session that never ends a game", async () => {
        const { port, summary } = setup(settingsWith(CHANNEL));
        await summary.handle(gameStart);
        await summary.handle({ type: "session-ended", guildId: GUILD, sessionId: SESSION });
        expect(port.post).not.toHaveBeenCalled();
    });
});
