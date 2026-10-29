import { describe, expect, it } from "vitest";
import {
    CLOSE_BLOCKED,
    CLOSE_HELLO_TIMEOUT,
    CLOSE_INVALID_MESSAGE,
    CLOSE_PROTOCOL_TOO_OLD,
    CLOSE_REPLACED,
    CLOSE_TOO_MANY_SESSIONS,
    CLOSE_UNAUTHORIZED,
    MIN_PROTOCOL_VERSION,
    NOTICE_CODES,
    PROTOCOL_VERSION,
    parsePluginMessage,
    serialize,
} from "../../src/Protocol/PluginProtocol";

const json = (value: unknown) => JSON.stringify(value);

describe("parsePluginMessage", () => {
    it("parses each valid message type", () => {
        const hello = {
            type: "hello",
            protocolVersion: 2,
            secret: "s",
            pluginVersion: "1.0.0",
            gameVersion: "2024.1.1",
        };
        const gameEvent = {
            type: "game-event",
            event: "meeting-start",
            hostAccountName: "Host",
            players: ["a", "b"],
            deadPlayers: ["b"],
        };
        const linkChat = { type: "link-chat", code: "abc", accountName: "Host" };
        const pluginLog = {
            type: "plugin-log",
            level: "warning",
            source: "Patch",
            message: "hi",
        };
        for (const msg of [hello, gameEvent, linkChat, pluginLog]) {
            expect(parsePluginMessage(json(msg))).toEqual(msg);
        }
    });

    it("hello accepts a 32 hex connectionKey and drops a malformed one", () => {
        const base = {
            type: "hello",
            protocolVersion: 3,
            secret: "test-secret",
            pluginVersion: "3.0.0",
            gameVersion: "2026.9.29",
        };
        const connectionKey = "0123456789abcdef0123456789abcdef";

        expect(parsePluginMessage(json({ ...base, connectionKey }))).toEqual({ ...base, connectionKey });
        for (const malformed of ["0123456789ABCDEF0123456789ABCDEF", "abc", 42, `${connectionKey}0`]) {
            expect(parsePluginMessage(json({ ...base, connectionKey: malformed }))).toEqual(base);
        }
    });

    it("rejects unknown type", () => {
        expect(parsePluginMessage(json({ type: "nope" }))).toBeNull();
    });

    it("rejects non-JSON", () => {
        expect(parsePluginMessage("{not json")).toBeNull();
    });

    it("rejects players over 128", () => {
        const msg = {
            type: "game-event",
            event: "lobby",
            hostAccountName: "Host",
            players: Array.from({ length: 129 }, (_, i) => `p${i}`),
            deadPlayers: [],
        };
        expect(parsePluginMessage(json(msg))).toBeNull();
    });

    it("rejects names over 64 chars", () => {
        const msg = {
            type: "link-chat",
            code: "abc",
            accountName: "x".repeat(65),
        };
        expect(parsePluginMessage(json(msg))).toBeNull();
    });

    it("rejects an empty or oversized secret", () => {
        const base = {
            type: "hello",
            protocolVersion: 2,
            pluginVersion: "1",
            gameVersion: "1",
        };
        expect(parsePluginMessage(json({ ...base, secret: "" }))).toBeNull();
        expect(parsePluginMessage(json({ ...base, secret: "x".repeat(257) }))).toBeNull();
    });
});

describe("protocol v3 messages", () => {
    const v2GameEvent = {
        type: "game-event",
        event: "meeting-end",
        hostAccountName: "Host",
        players: ["Host", "Crew"],
        deadPlayers: [],
    };
    const roster = [
        { name: "Host", friendCode: "host#1234", dead: false, disconnected: false },
        { name: "Crew", dead: true, disconnected: false },
    ];

    it("still parses a v2 game-event without roster", () => {
        expect(parsePluginMessage(json(v2GameEvent))).toEqual(v2GameEvent);
    });

    it("parses a v3 game-event with roster and lobby code", () => {
        const msg = { ...v2GameEvent, roster, lobbyCode: "ABCDEF" };
        expect(parsePluginMessage(json(msg))).toEqual(msg);
    });

    it("drops a lobby code that is not 4 to 8 upper-case letters but keeps the event", () => {
        for (const lobbyCode of ["abc<", "ABCDEFGHI", 42]) {
            const parsed = parsePluginMessage(json({ ...v2GameEvent, lobbyCode }));
            expect(parsed).toMatchObject(v2GameEvent);
            expect(parsed).toHaveProperty("lobbyCode", undefined);
        }
    });

    it("parses player-died", () => {
        const msg = { ...v2GameEvent, event: "player-died", deadPlayers: ["Crew"] };
        expect(parsePluginMessage(json(msg))).toEqual(msg);
    });

    it("parses game-end and rejects more than 128 roster entries", () => {
        const gameEnd = { type: "game-end", reason: "HumansByVote", winners: ["Host"], roster };
        expect(parsePluginMessage(json(gameEnd))).toEqual(gameEnd);
        const tooMany = Array.from({ length: 129 }, (_, i) => ({ name: `p${i}`, dead: false, disconnected: false }));
        expect(parsePluginMessage(json({ ...gameEnd, roster: tooMany }))).toBeNull();
    });

    it("accepts an optional friend code on link-chat", () => {
        const msg = { type: "link-chat", code: "abc", accountName: "Host", friendCode: "host#1234" };
        expect(parsePluginMessage(json(msg))).toEqual(msg);
        expect(parsePluginMessage(json({ ...msg, friendCode: "x".repeat(33) }))).toMatchObject({
            code: "abc",
            accountName: "Host",
            friendCode: undefined,
        });
    });

    it("drops an invalid roster friend code but keeps the roster entry", () => {
        const bad = [{ name: "Host", friendCode: "x".repeat(33), dead: false, disconnected: false }];
        const parsed = parsePluginMessage(json({ ...v2GameEvent, roster: bad }));
        expect(parsed).toMatchObject({ roster: [{ name: "Host", dead: false, disconnected: false }] });
    });
});

describe("serialize and constants", () => {
    it("serializes gateway messages", () => {
        expect(JSON.parse(serialize({ type: "welcome", protocolVersion: 2 }))).toEqual({
            type: "welcome",
            protocolVersion: 2,
        });
        const notice = {
            type: "notice",
            code: "host-not-linked",
            message: "m",
        } as const;
        expect(JSON.parse(serialize(notice))).toEqual(notice);
        const linkResult = { type: "link-result", status: "not-found", accountName: "Crew" } as const;
        expect(JSON.parse(serialize(linkResult))).toEqual(linkResult);
    });

    it("exposes versions and close codes", () => {
        expect(PROTOCOL_VERSION).toBe(3);
        expect(MIN_PROTOCOL_VERSION).toBe(2);
        expect([
            CLOSE_HELLO_TIMEOUT,
            CLOSE_UNAUTHORIZED,
            CLOSE_PROTOCOL_TOO_OLD,
            CLOSE_INVALID_MESSAGE,
            CLOSE_REPLACED,
        ]).toEqual([4000, 4001, 4002, 4003, 4004]);
        expect([CLOSE_BLOCKED, CLOSE_TOO_MANY_SESSIONS]).toEqual([4005, 4006]);
        expect(NOTICE_CODES).toContain("host-blocked");
    });
});
