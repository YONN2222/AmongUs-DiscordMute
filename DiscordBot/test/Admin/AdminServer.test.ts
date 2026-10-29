import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminHandlers } from "../../src/Admin/AdminHandlers";
import { createAdminServer } from "../../src/Admin/AdminServer";
import { ADMIN_API_PREFIX, MAX_BODY_BYTES } from "../../src/Admin/Contract";
import { logger } from "../../src/Logging/Logger";

vi.mock("node:crypto", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:crypto")>();
    return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const TOKEN = "t".repeat(40);
const GUILD_ID = "123456789012345678";

function fakeHandlers(overrides: Partial<AdminHandlers> = {}): AdminHandlers {
    const unused = async () => {
        throw new Error("unexpected call");
    };
    return {
        health: async () => ({ status: "ok", mode: "hosted", version: "3.0.0" }),
        overview: unused,
        listGuilds: async () => ({ rows: [], total: 0 }),
        getGuild: async () => null,
        leaveGuild: unused,
        listBlocks: async () => ({ rows: [], total: 0 }),
        createBlock: unused,
        removeBlock: unused,
        listAudit: async () => ({ rows: [], total: 0 }),
        recordDashboardAudit: unused,
        ...overrides,
    };
}

describe("admin server", () => {
    let server: ReturnType<typeof createAdminServer>;
    let baseUrl: string;

    async function start(handlers: AdminHandlers): Promise<void> {
        server = createAdminServer({ token: TOKEN, handlers });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${ADMIN_API_PREFIX}`;
    }

    const authorized = { Authorization: `Bearer ${TOKEN}` };

    let errorLog: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorLog = vi.spyOn(logger, "error").mockImplementation(() => {});
    });

    afterEach(async () => {
        errorLog.mockRestore();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });

    it("missing or wrong token is 401", async () => {
        await start(fakeHandlers());

        const missing = await fetch(`${baseUrl}/health`);
        const wrong = await fetch(`${baseUrl}/health`, { headers: { Authorization: "Bearer nope" } });
        const wrongScheme = await fetch(`${baseUrl}/health`, { headers: { Authorization: `Basic ${TOKEN}` } });

        for (const response of [missing, wrong, wrongScheme]) {
            expect(response.status).toBe(401);
            expect(await response.json()).toEqual({
                ok: false,
                error: { code: "unauthorized", message: "Missing or invalid token" },
            });
        }
    });

    it("token compare does not short-circuit on length", async () => {
        vi.mocked(timingSafeEqual).mockClear();
        await start(fakeHandlers());

        await fetch(`${baseUrl}/health`, { headers: { Authorization: "Bearer x" } });

        expect(timingSafeEqual).toHaveBeenCalledTimes(1);
        const [given, expected] = vi.mocked(timingSafeEqual).mock.calls[0] as [Buffer, Buffer];
        expect(given.length).toBe(expected.length);
    });

    it("serves health with the success envelope", async () => {
        await start(fakeHandlers());

        const response = await fetch(`${baseUrl}/health`, { headers: authorized });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, data: { status: "ok", mode: "hosted", version: "3.0.0" } });
    });

    it("unknown path and wrong method are 404", async () => {
        await start(fakeHandlers());
        const origin = baseUrl.replace(ADMIN_API_PREFIX, "");

        const unknown = await fetch(`${baseUrl}/nothing`, { headers: authorized });
        const outsidePrefix = await fetch(`${origin}/health`, { headers: authorized });
        const wrongMethod = await fetch(`${baseUrl}/health`, { method: "POST", headers: authorized });

        for (const response of [unknown, outsidePrefix, wrongMethod]) {
            expect(response.status).toBe(404);
            expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not-found");
        }
    });

    it("17 KiB body is 413", async () => {
        await start(fakeHandlers());
        expect(MAX_BODY_BYTES).toBe(16384);

        const response = await fetch(`${baseUrl}/audit`, {
            method: "POST",
            headers: { ...authorized, "Content-Type": "application/json" },
            body: JSON.stringify({ filler: "x".repeat(17 * 1024) }),
        });

        expect(response.status).toBe(413);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe("payload-too-large");
    });

    it("invalid json is 400", async () => {
        await start(fakeHandlers());

        const response = await fetch(`${baseUrl}/audit`, {
            method: "POST",
            headers: { ...authorized, "Content-Type": "application/json" },
            body: "{not json",
        });

        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalid-request");
    });

    it("a body that breaks the schema is 400 and names the field", async () => {
        await start(fakeHandlers());

        const response = await fetch(`${baseUrl}/audit`, {
            method: "POST",
            headers: { ...authorized, "Content-Type": "application/json" },
            body: JSON.stringify({ actorId: "not-an-id", action: "dashboard.login" }),
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe("invalid-request");
        expect(body.error.message).toContain("actorId");
    });

    it("a non-numeric guild id is 400", async () => {
        await start(fakeHandlers());

        const response = await fetch(`${baseUrl}/guilds/abc`, { headers: authorized });

        expect(response.status).toBe(400);
    });

    it("handler error is 500 without details", async () => {
        await start(
            fakeHandlers({
                listGuilds: async () => {
                    throw new Error("database password is hunter2");
                },
            }),
        );

        const response = await fetch(`${baseUrl}/guilds`, { headers: authorized });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ ok: false, error: { code: "internal", message: "Internal error" } });
        expect(errorLog).toHaveBeenCalled();
    });

    it("limit 100000 is clamped to 100", async () => {
        const listGuilds = vi.fn(async () => ({ rows: [], total: 7 }));
        await start(fakeHandlers({ listGuilds }));

        const response = await fetch(`${baseUrl}/guilds?limit=100000&page=2&q=crew`, { headers: authorized });

        expect(listGuilds).toHaveBeenCalledWith({ page: 2, limit: 100, q: "crew" });
        expect(await response.json()).toEqual({ ok: true, data: [], meta: { total: 7, page: 2, limit: 100 } });
    });

    it("an unknown guild is 404", async () => {
        await start(fakeHandlers());

        const response = await fetch(`${baseUrl}/guilds/${GUILD_ID}`, { headers: authorized });

        expect(response.status).toBe(404);
    });

    it("responses are no-store json", async () => {
        await start(fakeHandlers());

        const ok = await fetch(`${baseUrl}/health`, { headers: authorized });
        const denied = await fetch(`${baseUrl}/health`);

        for (const response of [ok, denied]) {
            expect(response.headers.get("content-type")).toBe("application/json");
            expect(response.headers.get("cache-control")).toBe("no-store");
        }
    });
});
