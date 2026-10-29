import { describe, expect, it } from "vitest";
import { parsePluginMessage, serialize } from "../../src/Protocol/PluginProtocol";

const hello = { type: "hello", protocolVersion: 2, secret: "s", pluginVersion: "1", gameVersion: "1" };
const gameEvent = {
    type: "game-event",
    event: "lobby",
    hostAccountName: "h",
    players: [] as string[],
    deadPlayers: [] as string[],
};
const linkChat = { type: "link-chat", code: "c", accountName: "a" };
const pluginLog = { type: "plugin-log", level: "info", source: "s", message: "m" };

const str = (n: number) => "x".repeat(n);
const list = (n: number, len = 1) => Array.from({ length: n }, () => str(len));

interface LimitCase {
    name: string;
    base: Record<string, unknown>;
    field: string;
    ok: unknown;
    bad: unknown;
}

const limits: LimitCase[] = [
    { name: "players count", base: gameEvent, field: "players", ok: list(128), bad: list(129) },
    { name: "deadPlayers count", base: gameEvent, field: "deadPlayers", ok: list(128), bad: list(129) },
    { name: "players entry length", base: gameEvent, field: "players", ok: [str(64)], bad: [str(65)] },
    { name: "deadPlayers entry length", base: gameEvent, field: "deadPlayers", ok: [str(64)], bad: [str(65)] },
    { name: "hostAccountName", base: gameEvent, field: "hostAccountName", ok: str(64), bad: str(65) },
    { name: "code", base: linkChat, field: "code", ok: str(64), bad: str(65) },
    { name: "accountName", base: linkChat, field: "accountName", ok: str(64), bad: str(65) },
    { name: "source", base: pluginLog, field: "source", ok: str(64), bad: str(65) },
    { name: "pluginVersion", base: hello, field: "pluginVersion", ok: str(32), bad: str(33) },
    { name: "gameVersion", base: hello, field: "gameVersion", ok: str(32), bad: str(33) },
    { name: "secret max", base: hello, field: "secret", ok: str(256), bad: str(257) },
    { name: "secret min", base: hello, field: "secret", ok: str(1), bad: "" },
    { name: "message", base: pluginLog, field: "message", ok: str(2000), bad: str(2001) },
    { name: "level enum", base: pluginLog, field: "level", ok: "fatal", bad: "trace" },
    { name: "event enum", base: gameEvent, field: "event", ok: "meeting-end", bad: "voting" },
    { name: "protocolVersion integer", base: hello, field: "protocolVersion", ok: 2, bad: 2.5 },
];

describe("field limits", () => {
    it.each(limits)("$name accepts the limit and rejects beyond it", ({ base, field, ok, bad }) => {
        expect(parsePluginMessage(JSON.stringify({ ...base, [field]: ok }))).toEqual({ ...base, [field]: ok });
        expect(parsePluginMessage(JSON.stringify({ ...base, [field]: bad }))).toBeNull();
    });

    it.each(
        [hello, gameEvent, linkChat, pluginLog].flatMap((base) =>
            Object.keys(base)
                .filter((key) => key !== "type")
                .map((key) => ({ type: base.type, base, key })),
        ),
    )("rejects $type without $key", ({ base, key }) => {
        const { [key]: _removed, ...rest } = base as Record<string, unknown>;
        expect(parsePluginMessage(JSON.stringify(rest))).toBeNull();
    });
});

describe("hostile input", () => {
    it.each(["null", "[]", "1", '""', "true", ""])("rejects %j", (raw) => {
        expect(parsePluginMessage(raw)).toBeNull();
    });

    it("rejects protocolVersion 1e999", () => {
        expect(
            parsePluginMessage(
                '{"type":"hello","protocolVersion":1e999,"secret":"s","pluginVersion":"1","gameVersion":"1"}',
            ),
        ).toBeNull();
    });

    it("rejects wrong-typed players", () => {
        expect(parsePluginMessage(JSON.stringify({ ...gameEvent, players: "a" }))).toBeNull();
        expect(parsePluginMessage(JSON.stringify({ ...gameEvent, players: [1] }))).toBeNull();
    });

    it("strips extra fields", () => {
        const parsed = parsePluginMessage(JSON.stringify({ ...linkChat, extra: "x" }));
        expect(parsed).toEqual(linkChat);
        expect(parsed).not.toHaveProperty("extra");
    });

    it("strips __proto__ and constructor keys without polluting prototypes", () => {
        const raw = `{"type":"link-chat","code":"c","accountName":"a","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}`;
        const parsed = parsePluginMessage(raw);
        expect(parsed).toEqual(linkChat);
        expect(Object.keys(parsed ?? {})).toEqual(["type", "code", "accountName"]);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("returns null for deeply nested JSON without throwing", () => {
        expect(parsePluginMessage("[".repeat(100000))).toBeNull();
    });
});

describe("serialize", () => {
    it("serializes link-pending", () => {
        const msg = { type: "link-pending", phrase: "p", quickChatCode: "1-2", discordId: "d" } as const;
        expect(JSON.parse(serialize(msg))).toEqual(msg);
    });
});
