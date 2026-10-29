import type { REST } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/Logging/Logger";

vi.mock("../src/Config", () => ({ DISCORD_CLIENT_ID: "1500000000000000001", DISCORD_TOKEN: "test-token" }));

const CLIENT_ID = "1500000000000000001";
const GUILD_ID = "1200000000000000001";

describe("deployCommands", () => {
    const put = vi.fn(async (_route: string, _options: unknown) => []);
    const rest = { put } as unknown as REST;

    beforeEach(() => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
        put.mockClear();
    });

    it("deploys to one guild", async () => {
        const { deployCommands } = await import("../src/DeployCommands");

        await deployCommands({ target: { guildId: GUILD_ID }, rest });

        expect(put).toHaveBeenCalledWith(`/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`, expect.anything());
    });

    it("global deploy uses the application commands route", async () => {
        const { deployCommands } = await import("../src/DeployCommands");

        await deployCommands({ target: "global", rest });

        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith(`/applications/${CLIENT_ID}/commands`, expect.anything());
    });
});
