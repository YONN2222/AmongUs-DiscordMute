import { describe, expect, it } from "vitest";
import {
    CLOSE_HELLO_TIMEOUT,
    CLOSE_INVALID_MESSAGE,
    CLOSE_PROTOCOL_TOO_OLD,
    CLOSE_REPLACED,
    CLOSE_UNAUTHORIZED,
    MIN_PROTOCOL_VERSION,
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
    });

    it("exposes versions and close codes", () => {
        expect(PROTOCOL_VERSION).toBe(2);
        expect(MIN_PROTOCOL_VERSION).toBe(2);
        expect([
            CLOSE_HELLO_TIMEOUT,
            CLOSE_UNAUTHORIZED,
            CLOSE_PROTOCOL_TOO_OLD,
            CLOSE_INVALID_MESSAGE,
            CLOSE_REPLACED,
        ]).toEqual([4000, 4001, 4002, 4003, 4004]);
    });
});
