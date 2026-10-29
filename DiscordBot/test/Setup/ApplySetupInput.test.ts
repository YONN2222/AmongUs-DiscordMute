import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/Settings/GuildSettings";
import { applySetupInput, setupPageOf } from "../../src/Setup/ApplySetupInput";

const apply = (field: string, values: string[]) => applySetupInput(field, values, DEFAULT_SETTINGS);
const CHANNEL = "1300000000000000123";

describe("applySetupInput", () => {
    it("voiceChannelIds accepts 10 ids and rejects 11", () => {
        const ids = (count: number) =>
            Array.from({ length: count }, (_, i) => `13000000000000001${String(i).padStart(2, "0")}`);

        expect(apply("voiceChannelIds", ids(10))).toEqual({ patch: { voiceChannelIds: ids(10) } });
        expect(apply("voiceChannelIds", [])).toEqual({ patch: { voiceChannelIds: [] } });
        expect(apply("voiceChannelIds", ids(11))).toEqual({ error: "setup.error.invalid" });
        expect(apply("voiceChannelIds", ["abc"])).toEqual({ error: "setup.error.invalid" });
    });

    it("patches one voice rule leaf", () => {
        expect(apply("voiceRules.tasks.dead", ["free"])).toEqual({
            patch: { voiceRules: { tasks: { dead: "free" } } },
        });
    });

    it("rejects values outside the enum", () => {
        expect(apply("voiceRules.tasks.dead", ["loud"])).toEqual({ error: "setup.error.invalid" });
        expect(apply("language", ["fr"])).toEqual({ error: "setup.error.invalid" });
        expect(apply("summary.deleteAfterMinutes", ["7"])).toEqual({ error: "setup.error.invalid" });
    });

    it("accepts every offered summary deletion time", () => {
        expect(apply("summary.deleteAfterMinutes", ["1440"])).toEqual({
            patch: { summary: { deleteAfterMinutes: 1440 } },
        });
        expect(apply("summary.deleteAfterMinutes", ["0"])).toEqual({ patch: { summary: { deleteAfterMinutes: 0 } } });
    });

    it("converts delay seconds with a comma or a dot to milliseconds", () => {
        expect(apply("delays-modal", ["1,5", "0", "0", "0"])).toEqual({
            patch: { delaysMs: { gameStart: 1500, meetingStart: 0, meetingEnd: 0, lobby: 0 } },
        });
        expect(apply("delays-modal", ["0", "2.25", "5", " 0.5 "])).toEqual({
            patch: { delaysMs: { gameStart: 0, meetingStart: 2250, meetingEnd: 5000, lobby: 500 } },
        });
    });

    it("rejects delays above 5 seconds, non-numbers and a wrong field count", () => {
        const error = { error: "setup.error.delay" };
        expect(apply("delays-modal", ["6", "0", "0", "0"])).toEqual(error);
        expect(apply("delays-modal", ["0", "abc", "0", "0"])).toEqual(error);
        expect(apply("delays-modal", ["0", "-1", "0", "0"])).toEqual(error);
        expect(apply("delays-modal", ["0", "", "0", "0"])).toEqual(error);
        expect(apply("delays-modal", ["0"])).toEqual({ error: "setup.error.invalid" });
    });

    it("clears a channel when nothing is selected and stores a valid one", () => {
        expect(apply("linkOverview.channelId", [])).toEqual({ patch: { linkOverview: { channelId: null } } });
        expect(apply("logChannelId", [CHANNEL])).toEqual({ patch: { logChannelId: CHANNEL } });
        expect(apply("status.channelId", ["not-an-id"])).toEqual({ error: "setup.error.invalid" });
    });

    it("flips a toggle from the current value", () => {
        expect(apply("ghostChat", [])).toEqual({ patch: { ghostChat: true } });
        expect(apply("autoRelink", [])).toEqual({ patch: { autoRelink: false } });
        expect(apply("linkOverview.showPending", [])).toEqual({ patch: { linkOverview: { showPending: true } } });
    });

    it("rejects unknown fields", () => {
        expect(apply("bogus", [])).toEqual({ error: "setup.error.invalid" });
        expect(apply("__proto__", ["x"])).toEqual({ error: "setup.error.invalid" });
        expect(apply("voiceRules.lobby.dead", ["free"])).toEqual({ error: "setup.error.invalid" });
    });

    it("maps every field to the page it is shown on", () => {
        expect(setupPageOf("language")).toBe("general");
        expect(setupPageOf("autoRelink")).toBe("links");
        expect(setupPageOf("delays-modal")).toBe("voice");
        expect(setupPageOf("nonPlayers")).toBe("voice");
        expect(setupPageOf("nicknameSync")).toBe("game");
    });
});
