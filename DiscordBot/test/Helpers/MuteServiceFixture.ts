import { afterEach, beforeEach, vi } from "vitest";
import type { Database } from "../../src/Data/Database";
import { logger } from "../../src/Logging/Logger";
import { MuteService, type VoiceAdapter, type VoiceMember } from "../../src/Mute/MuteService";
import type { VoiceTarget } from "../../src/Mute/VoiceTarget";
import type { GameEventName } from "../../src/Protocol/PluginProtocol";
import type { ClusterRequest } from "../../src/Routing/Messages";
import { DEFAULT_SETTINGS, type GuildSettings } from "../../src/Settings/GuildSettings";
import { createTestDatabase } from "./TestDatabase";

export type GameEventRequest = Extract<ClusterRequest, { kind: "game-event" }>;

export const GUILD = "g1";

/** Shaped like the DiscordAPIError discord.js throws for a 4xx: Discord rejected the call. */
export const missingPermission = () => Object.assign(new Error("Missing Permissions"), { code: 50013, status: 403 });

export const serviceUnavailable = () => Object.assign(new Error("Service Unavailable"), { status: 503 });

export class FakeVoice implements VoiceAdapter {
    readonly channels = new Map<string, string[]>();
    readonly muted = new Set<string>();
    readonly deafened = new Set<string>();
    readonly bots = new Set<string>();
    readonly failing = new Set<string>();
    readonly failOnce = new Set<string>();
    /** The next call for these members goes through at Discord, but the bot only sees the request time out. */
    readonly timeoutAfterApplying = new Set<string>();
    readonly failingChannels = new Set<string>();
    readonly calls: Array<{ discordId: string; mute: boolean }> = [];
    readonly stateCalls: Array<{ discordId: string; patch: { mute?: boolean; deaf?: boolean } }> = [];
    delay: () => number = () => 0;
    beforeSetMute: (discordId: string, mute: boolean) => Promise<void> = async () => {};
    afterSetMute: (discordId: string, mute: boolean) => void = () => {};
    /** The voice states reads report while Discord has not yet sent the update for the bot's own calls. */
    private lagged: { muted: Set<string>; deafened: Set<string> } | null = null;

    /** From now on reads keep reporting the current voice states, as the gateway cache does right after an edit. */
    lagVoiceStateUpdates(): void {
        this.lagged = { muted: new Set(this.muted), deafened: new Set(this.deafened) };
    }

    private async wait(): Promise<void> {
        const ms = this.delay();
        if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private member(discordId: string): VoiceMember {
        return {
            discordId,
            serverMuted: (this.lagged?.muted ?? this.muted).has(discordId),
            serverDeafened: (this.lagged?.deafened ?? this.deafened).has(discordId),
            isBot: this.bots.has(discordId),
        };
    }

    async membersInChannel(_guildId: string, channelId: string): Promise<VoiceMember[]> {
        await this.wait();
        if (this.failingChannels.has(channelId)) throw new Error("Unknown Channel");
        return (this.channels.get(channelId) ?? []).map((id) => this.member(id));
    }

    async findVoiceMember(_guildId: string, discordId: string): Promise<VoiceMember | null> {
        await this.wait();
        const inVoice = [...this.channels.values()].some((members) => members.includes(discordId));
        return inVoice ? this.member(discordId) : null;
    }

    async setVoiceState(_guildId: string, discordId: string, patch: { mute?: boolean; deaf?: boolean }): Promise<void> {
        await this.wait();
        await this.beforeSetMute(discordId, patch.mute === true);
        this.stateCalls.push({ discordId, patch });
        if (patch.mute !== undefined) this.calls.push({ discordId, mute: patch.mute });
        if (this.failing.has(discordId)) throw missingPermission();
        if (this.failOnce.delete(discordId)) throw serviceUnavailable();
        if (this.timeoutAfterApplying.delete(discordId)) {
            this.apply(discordId, patch);
            throw new Error("Request aborted");
        }
        this.apply(discordId, patch);
        this.afterSetMute(discordId, patch.mute === true);
    }

    private apply(discordId: string, patch: { mute?: boolean; deaf?: boolean }): void {
        if (patch.mute === true) this.muted.add(discordId);
        if (patch.mute === false) this.muted.delete(discordId);
        if (patch.deaf === true) this.deafened.add(discordId);
        if (patch.deaf === false) this.deafened.delete(discordId);
    }

    leave(discordId: string): void {
        for (const [channelId, members] of this.channels) {
            this.channels.set(
                channelId,
                members.filter((id) => id !== discordId),
            );
        }
    }
}

export function gameEvent(event: GameEventName, players: string[], deadPlayers: string[] = []): GameEventRequest {
    return { kind: "game-event", guildId: GUILD, sessionId: "s1", hostAccountName: "Red", event, players, deadPlayers };
}

/** The state every MuteService test starts from; a test may replace any field before it creates the service. */
export interface MuteServiceFixture {
    db: Database;
    voice: FakeVoice;
    target: VoiceTarget;
    settings: GuildSettings;
    sleep: (ms: number) => Promise<void>;
    createService(): MuteService;
    /** releaseIfIdle lifts a left-behind mute only while its session does not run, which makes the session observable. */
    sessionIsActive(service: MuteService, sessionId?: string, guildId?: string): Promise<boolean>;
    ledgerIds(): Promise<string[]>;
}

/** Call inside a describe: resets the fixture before each test (three linked players, target channel c1). */
export function useMuteServiceFixture(): MuteServiceFixture {
    const fx = {
        createService(): MuteService {
            return new MuteService({
                voice: fx.voice,
                links: fx.db.links,
                ledger: fx.db.muteLedger,
                resolveTarget: async () => fx.target,
                settings: { get: async () => fx.settings },
                sleep: (ms) => fx.sleep(ms),
            });
        },

        async sessionIsActive(service: MuteService, sessionId = "s1", guildId = GUILD): Promise<boolean> {
            const probe = "session-probe";
            const callsBefore = fx.voice.calls.length;
            fx.voice.channels.set("probe-channel", [probe]);
            fx.voice.muted.add(probe);
            await fx.db.muteLedger.set(guildId, probe, { muted: true, deafened: false }, sessionId);

            await service.releaseIfIdle(guildId, probe);
            const active = fx.voice.muted.has(probe);

            fx.voice.channels.delete("probe-channel");
            fx.voice.muted.delete(probe);
            fx.voice.calls.splice(callsBefore);
            await fx.db.muteLedger.remove(guildId, probe);
            return active;
        },

        async ledgerIds(): Promise<string[]> {
            return (await fx.db.muteLedger.listByGuild(GUILD)).map((e) => e.discordId).sort();
        },
    } as MuteServiceFixture;

    beforeEach(async () => {
        for (const level of ["info", "warn", "error", "debug", "success"] as const) {
            vi.spyOn(logger, level).mockImplementation(() => {});
        }
        fx.db = await createTestDatabase();
        fx.voice = new FakeVoice();
        fx.target = { channelIds: ["c1"] };
        fx.settings = DEFAULT_SETTINGS;
        fx.sleep = async () => {};
        await fx.db.links.upsert(GUILD, "u1", "Red");
        await fx.db.links.upsert(GUILD, "u2", "Blue");
        await fx.db.links.upsert(GUILD, "u3", "Green");
    });

    afterEach(async () => {
        await fx.db.close();
        vi.restoreAllMocks();
    });

    return fx;
}
