import { Client, GatewayIntentBits } from "discord.js";
import { afterEach, expect, it } from "vitest";
import { createTestProbe } from "./helpers/probe";

function createPingBot(): Client {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.on("interactionCreate", async (interaction) => {
        if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
            await interaction.reply("pong");
        }
    });
    return client;
}

const probe = createTestProbe(createPingBot());

afterEach(async () => {
    await probe.teardown();
});

it("replies pong to /ping through the probe transport", async () => {
    await probe.setup();

    await probe.slashCommand("ping").invoke();

    expect(probe.lastReply()).toMatchObject({ content: "pong" });
});
