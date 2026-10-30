import { buildGuildCreateDispatch, buildSlashCommandInteractionDispatch, DEFAULT_IDS, extractText } from "probe.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "../../src/Gateway/GuildSecrets";
import { BlockChecker } from "../../src/Hosted/BlockChecker";
import { type CommandProbe, createCommandProbe } from "../Helpers/CommandProbe";

const GUILD = DEFAULT_IDS.guild;
const EPHEMERAL = 1 << 6;
const UPDATE_MESSAGE = 7;
const admin = { member: { permissions: "32" } };

describe("/setup", () => {
    let bot: CommandProbe;

    beforeEach(async () => {
        bot = await createCommandProbe();
        bot.probe.injectDispatch(buildGuildCreateDispatch());
    });

    afterEach(async () => {
        await bot.close();
    });

    const reply = () => bot.probe.lastReply() ?? {};

    const lastUpdate = () => {
        const callbacks = bot.probe
            .capturedRequests()
            .filter((r) => /\/callback/.test(r.url) && (r.body as { type?: number })?.type === UPDATE_MESSAGE);
        return ((callbacks.at(-1)?.body as { data?: object })?.data ?? {}) as Parameters<typeof extractText>[0];
    };

    it("opens the general page privately for a member with Manage Server", async () => {
        await bot.probe.slashCommand("setup").withContext(admin).invoke();

        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(extractText(reply())).toContain("Log channel");
        expect(extractText(reply())).toContain("Among Us plugin: connected");
    });

    it("refuses members without Manage Server", async () => {
        await bot.probe.slashCommand("setup").invoke();

        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(extractText(reply())).toContain("Manage Server");
        expect(extractText(reply())).not.toContain("Log channel");
    });

    it("switches the page with the page select", async () => {
        await bot.probe.selectMenu("setup:page").withValues(["voice"]).withContext(admin).select();

        expect(extractText(lastUpdate())).toContain("leaks information");
    });

    it("saves a voice rule and redraws the page", async () => {
        await bot.probe.selectMenu("setup:voiceRules.meeting.dead").withValues(["deafen"]).withContext(admin).select();

        expect((await bot.db.settings.get(GUILD)).voiceRules.meeting.dead).toBe("deafen");
        expect(extractText(lastUpdate())).toContain("Dead players in meetings");
    });

    it("toggles a setting with its button", async () => {
        await bot.probe.button("setup:nicknameSync").withContext(admin).click();

        expect((await bot.db.settings.get(GUILD)).nicknameSync).toBe(true);
        expect(JSON.stringify(lastUpdate())).toContain("Nickname sync: On");
    });

    it("saves the delays from the modal", async () => {
        await bot.probe
            .modal("setup:delays-modal")
            .withFields({ gameStart: "1,5", meetingStart: "2", meetingEnd: "0", lobby: "0" })
            .withContext(admin)
            .submit();

        const { delaysMs } = await bot.db.settings.get(GUILD);
        expect(delaysMs).toEqual({ gameStart: 1500, meetingStart: 2000, meetingEnd: 0, lobby: 0 });
    });

    it("rejects a delay above 5 seconds and keeps the stored values", async () => {
        await bot.probe
            .modal("setup:delays-modal")
            .withFields({ gameStart: "9", meetingStart: "2", meetingEnd: "0", lobby: "0" })
            .withContext(admin)
            .submit();

        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(extractText(reply())).toContain("between 0 and 5");
        expect((await bot.db.settings.get(GUILD)).delaysMs.meetingStart).toBe(0);
    });

    it("opens the delays modal", async () => {
        await bot.probe.button("setup:delays").withContext(admin).click();

        expect(bot.probe.lastModal()).toMatchObject({ customId: "setup:delays-modal" });
    });

    it("does not change settings for members without Manage Server", async () => {
        await bot.probe.selectMenu("setup:voiceRules.meeting.dead").withValues(["deafen"]).select();

        expect(extractText(reply())).toContain("Manage Server");
        await vi.waitFor(async () => expect((await bot.db.settings.get(GUILD)).voiceRules.meeting.dead).toBe("mute"));
    });

    it("answers in the locale of the clicking user", async () => {
        bot.inject(buildSlashCommandInteractionDispatch("setup", admin), "de");

        await vi.waitFor(() => expect(bot.probe.lastReply()).toBeDefined());
        expect(extractText(reply())).toContain("Server-Einrichtung");
    });
});

describe("/setup secret in self-host mode", () => {
    const ACTOR = "1300000000000000099";
    const adminAsActor = { member: { permissions: "32" }, user: { id: ACTOR } };
    const SECRET_PATTERN = /dmh_[\w-]+/;
    let bot: CommandProbe;

    beforeEach(async () => {
        bot = await createCommandProbe();
        bot.probe.injectDispatch(buildGuildCreateDispatch());
    });

    afterEach(async () => {
        await bot.close();
    });

    const reply = () => bot.probe.lastReply() ?? {};

    it("creates the first secret and shows a plugin config without the hosted mode", async () => {
        await bot.probe.button("setup:secret").withContext(adminAsActor).click();

        const text = extractText(reply());
        const secret = SECRET_PATTERN.exec(text)?.[0] ?? "";
        expect(secret).not.toBe("");
        expect(text).toContain(`{ "secret": "${secret}" }`);
        expect(text).not.toContain('"mode"');
        expect(await bot.db.guildSecrets.findGuildByHash(hashSecret(secret))).toBe(GUILD);
        expect(bot.disconnectGuild).not.toHaveBeenCalled();
        expect(bot.events).toContainEqual({ type: "secret-changed", guildId: GUILD, actorId: ACTOR, created: true });
    });

    it("replaces the secret after confirmation and disconnects the running games", async () => {
        const first = await bot.db.guildSecrets.rotate(GUILD, ACTOR);

        await bot.probe.button("setup:secret").withContext(adminAsActor).click();
        expect(extractText(reply())).toContain("disconnects every running game");
        expect(bot.disconnectGuild).not.toHaveBeenCalled();

        await bot.probe.button("setup:secret-confirm").withContext(adminAsActor).click();
        const secret = SECRET_PATTERN.exec(extractText(reply()))?.[0] ?? "";
        expect(secret).not.toBe(first.secret);
        expect(await bot.db.guildSecrets.findGuildByHash(hashSecret(first.secret))).toBeNull();
        expect(await bot.db.guildSecrets.findGuildByHash(hashSecret(secret))).toBe(GUILD);
        expect(bot.disconnectGuild).toHaveBeenCalledWith(GUILD, 4001, "Secret changed");
        expect((await bot.db.audit.list({ offset: 0, limit: 10 })).rows).toEqual([]);
    });

    it("shows the secret state on the general page", async () => {
        await bot.probe.slashCommand("setup").withContext(adminAsActor).invoke();
        expect(extractText(reply())).toContain("No plugin secret yet");
    });

    it("does not let members without Manage Server create a secret", async () => {
        await bot.probe.button("setup:secret").click();

        expect(extractText(reply())).toContain("Manage Server");
        expect(await bot.db.guildSecrets.get(GUILD)).toBeNull();
    });
});

describe("/setup secret in hosted mode", () => {
    const ACTOR = "1300000000000000099";
    const adminAsActor = { member: { permissions: "32" }, user: { id: ACTOR } };
    const SECRET_PATTERN = /dmh_[\w-]+/;
    let bot: CommandProbe;
    let disconnectGuild: ReturnType<
        typeof vi.fn<(guildId: string, code: 4001 | 4005, reason: string) => Promise<boolean>>
    >;

    beforeEach(async () => {
        disconnectGuild = vi.fn(async () => true);
        bot = await createCommandProbe((db) => {
            const hosted = {
                secrets: db.guildSecrets,
                audit: db.audit,
                blocks: new BlockChecker({ blocks: db.blocks, hostedGuilds: db.hostedGuilds }),
                disconnectGuild,
            };
            return { hosted, pluginSecret: hosted };
        });
        bot.probe.injectDispatch(buildGuildCreateDispatch());
    });

    afterEach(async () => {
        await bot.close();
    });

    const reply = () => bot.probe.lastReply() ?? {};
    const secretIn = (text: string) => SECRET_PATTERN.exec(text)?.[0] ?? "";
    const auditRows = async () => (await bot.db.audit.list({ offset: 0, limit: 10 })).rows;

    it("create secret replies once with the secret and stores only its hash", async () => {
        await bot.probe.button("setup:secret").withContext(adminAsActor).click();

        const text = extractText(reply());
        const secret = secretIn(text);
        expect(Number(reply().flags) & EPHEMERAL).toBe(EPHEMERAL);
        expect(text).toContain("Copy this secret now");
        expect(text).toContain(`{ "mode": "hosted", "secret": "${secret}" }`);
        expect(await bot.db.guildSecrets.findGuildByHash(hashSecret(secret))).toBe(GUILD);
        expect(JSON.stringify(await auditRows())).not.toContain(secret);
        expect(disconnectGuild).not.toHaveBeenCalled();
        expect(bot.events).toContainEqual({ type: "secret-changed", guildId: GUILD, actorId: ACTOR, created: true });
        expect((await auditRows()).map((row) => row.action)).toEqual(["secret.create"]);
    });

    it("regenerate asks for confirmation first", async () => {
        await bot.db.guildSecrets.rotate(GUILD, ACTOR);
        const before = await bot.db.guildSecrets.get(GUILD);

        await bot.probe.button("setup:secret").withContext(adminAsActor).click();

        expect(extractText(reply())).toContain("disconnects every running game");
        expect(JSON.stringify(reply())).toContain("setup:secret-confirm");
        expect(await bot.db.guildSecrets.get(GUILD)).toEqual(before);
        expect(disconnectGuild).not.toHaveBeenCalled();
        expect(await auditRows()).toEqual([]);
    });

    it("confirmed regenerate disconnects the guild and writes an audit row without the secret", async () => {
        const first = await bot.db.guildSecrets.rotate(GUILD, ACTOR);

        await bot.probe.button("setup:secret-confirm").withContext(adminAsActor).click();

        const secret = secretIn(extractText(reply()));
        expect(secret).not.toBe("");
        expect(secret).not.toBe(first.secret);
        expect(await bot.db.guildSecrets.findGuildByHash(hashSecret(first.secret))).toBeNull();
        expect(await bot.db.guildSecrets.findGuildByHash(hashSecret(secret))).toBe(GUILD);
        expect(disconnectGuild).toHaveBeenCalledWith(GUILD, 4001, "Secret changed");
        const rows = await auditRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            actorId: ACTOR,
            action: "secret.regenerate",
            targetType: "guild",
            targetId: GUILD,
        });
        expect(JSON.stringify(rows)).not.toContain(secret);
        expect(bot.events).toContainEqual({ type: "secret-changed", guildId: GUILD, actorId: ACTOR, created: false });
    });

    it("shows the new secret before the disconnect finishes, then writes the audit entry", async () => {
        await bot.db.guildSecrets.rotate(GUILD, ACTOR);
        let finishDisconnect = () => {};
        disconnectGuild.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    finishDisconnect = () => resolve(true);
                }),
        );

        await bot.probe.button("setup:secret-confirm").withContext(adminAsActor).click();

        expect(secretIn(extractText(reply()))).not.toBe("");
        expect(await auditRows()).toEqual([]);
        finishDisconnect();
        await vi.waitFor(async () =>
            expect((await auditRows()).map((row) => row.action)).toEqual(["secret.regenerate"]),
        );
    });

    it("still shows the secret and writes the audit entry when the disconnect fails", async () => {
        await bot.db.guildSecrets.rotate(GUILD, ACTOR);
        disconnectGuild.mockRejectedValueOnce(new Error("gateway timeout"));

        await bot.probe.button("setup:secret-confirm").withContext(adminAsActor).click();

        expect(secretIn(extractText(reply()))).not.toBe("");
        await vi.waitFor(async () =>
            expect((await auditRows()).map((row) => row.action)).toEqual(["secret.regenerate"]),
        );
    });

    it("non admin cannot press the secret button", async () => {
        await bot.probe.button("setup:secret").click();
        await bot.probe.button("setup:secret-confirm").click();

        expect(extractText(reply())).toContain("Manage Server");
        expect(await bot.db.guildSecrets.get(GUILD)).toBeNull();
        expect(disconnectGuild).not.toHaveBeenCalled();
    });

    it("shows the secret state on the general page", async () => {
        await bot.probe.slashCommand("setup").withContext(adminAsActor).invoke();
        expect(extractText(reply())).toContain("No plugin secret yet");

        await bot.db.guildSecrets.rotate(GUILD, ACTOR);
        await bot.probe.slashCommand("setup").withContext(adminAsActor).invoke();
        expect(extractText(reply())).toContain("Plugin secret: created");
    });
});
