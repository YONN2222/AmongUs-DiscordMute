import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminHandlers } from "../../src/Admin/AdminHandlers";
import { createAdminServer } from "../../src/Admin/AdminServer";
import { ADMIN_API_PREFIX, type ClusterInfo, MAX_BODY_BYTES } from "../../src/Admin/Contract";
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
        listClusters: async () => [],
        getCluster: async () => null,
        listGuilds: async () => ({ rows: [], total: 0 }),
        getGuild: async () => null,
        getGuildDetail: async () => null,
        listGuildLinks: async () => null,
        leaveGuild: unused,
        purgeGuild: unused,
        getUser: async () => null,
        getProfiles: async () => ({}),
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

    describe("guild detail and links", () => {
        it("unknown guilds are 404 and a non-numeric id is 400", async () => {
            await start(fakeHandlers());

            for (const path of ["detail", "links"]) {
                expect((await fetch(`${baseUrl}/guilds/${GUILD_ID}/${path}`, { headers: authorized })).status).toBe(
                    404,
                );
                expect((await fetch(`${baseUrl}/guilds/abc/${path}`, { headers: authorized })).status).toBe(400);
            }
        });

        it("serves the detail of a guild", async () => {
            const getGuildDetail = vi.fn(async () => ({ guildId: GUILD_ID }) as never);
            await start(fakeHandlers({ getGuildDetail }));

            const response = await fetch(`${baseUrl}/guilds/${GUILD_ID}/detail`, { headers: authorized });

            expect(getGuildDetail).toHaveBeenCalledWith(GUILD_ID);
            expect(await response.json()).toEqual({ ok: true, data: { guildId: GUILD_ID } });
        });

        it("pages the linked users with a clamped limit", async () => {
            const listGuildLinks = vi.fn(async () => ({ rows: [], total: 12 }));
            await start(fakeHandlers({ listGuildLinks }));

            const response = await fetch(`${baseUrl}/guilds/${GUILD_ID}/links?page=3&limit=500`, {
                headers: authorized,
            });

            expect(listGuildLinks).toHaveBeenCalledWith(GUILD_ID, { page: 3, limit: 100 });
            expect(await response.json()).toEqual({ ok: true, data: [], meta: { total: 12, page: 3, limit: 100 } });
        });
    });

    describe("users", () => {
        it("serves a stored user, 404 for an unknown one and 400 for an invalid id", async () => {
            const user = { userId: GUILD_ID, profile: null, links: [], ownedGuilds: [], block: null };
            const getUser = vi.fn(async (userId: string) => (userId === GUILD_ID ? user : null));
            await start(fakeHandlers({ getUser }));

            const found = await fetch(`${baseUrl}/users/${GUILD_ID}`, { headers: authorized });
            const unknown = await fetch(`${baseUrl}/users/223456789012345678`, { headers: authorized });
            const invalid = await fetch(`${baseUrl}/users/12345`, { headers: authorized });

            expect(await found.json()).toEqual({ ok: true, data: user });
            expect(unknown.status).toBe(404);
            expect(invalid.status).toBe(400);
        });

        it("is 503 while Discord cannot be asked about a user the bot knows nothing about", async () => {
            await start(fakeHandlers({ getUser: async () => "unavailable" as const }));

            const response = await fetch(`${baseUrl}/users/${GUILD_ID}`, { headers: authorized });

            expect(response.status).toBe(503);
            expect(((await response.json()) as { error: { code: string } }).error.code).toBe("unavailable");
        });
    });

    describe("profiles", () => {
        const idAt = (index: number) => `1234567890123456${String(index).padStart(2, "0")}`;

        it("looks up each requested id once", async () => {
            const getProfiles = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, null])));
            await start(fakeHandlers({ getProfiles }));

            const response = await fetch(`${baseUrl}/profiles?ids=${idAt(1)},${idAt(2)},${idAt(1)}`, {
                headers: authorized,
            });

            expect(getProfiles).toHaveBeenCalledWith([idAt(1), idAt(2)]);
            expect(await response.json()).toEqual({ ok: true, data: { [idAt(1)]: null, [idAt(2)]: null } });
        });

        it("allows at most 25 ids", async () => {
            await start(fakeHandlers());
            const ids = (count: number) => Array.from({ length: count }, (_, index) => idAt(index)).join(",");

            const allowed = await fetch(`${baseUrl}/profiles?ids=${ids(25)}`, { headers: authorized });
            const tooMany = await fetch(`${baseUrl}/profiles?ids=${ids(26)}`, { headers: authorized });

            expect(allowed.status).toBe(200);
            expect(tooMany.status).toBe(400);
        });

        it("an invalid or missing id is 400", async () => {
            await start(fakeHandlers());

            for (const query of [`?ids=${idAt(1)},abc`, "?ids=", `?ids=${idAt(1)},`, ""]) {
                const response = await fetch(`${baseUrl}/profiles${query}`, { headers: authorized });
                expect(response.status).toBe(400);
            }
        });
    });

    describe("clusters", () => {
        const cluster: ClusterInfo = {
            id: 1,
            ok: false,
            status: "stopped",
            shardIds: [2, 3],
            startedAt: 1000,
            guilds: null,
            wsPingMs: null,
            uptimeSeconds: null,
            memoryRssBytes: null,
            shards: [],
        };

        it("lists every cluster", async () => {
            await start(fakeHandlers({ listClusters: async () => [cluster] }));

            const response = await fetch(`${baseUrl}/clusters`, { headers: authorized });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true, data: [cluster] });
        });

        it("serves one cluster by its numeric id", async () => {
            const getCluster = vi.fn(async (id: number) => (id === 1 ? cluster : null));
            await start(fakeHandlers({ getCluster }));

            const found = await fetch(`${baseUrl}/clusters/1`, { headers: authorized });
            const missing = await fetch(`${baseUrl}/clusters/7`, { headers: authorized });

            expect(getCluster).toHaveBeenCalledWith(1);
            expect(await found.json()).toEqual({ ok: true, data: cluster });
            expect(missing.status).toBe(404);
        });

        it("a cluster id that is not a whole number from 0 is 400", async () => {
            await start(fakeHandlers());

            for (const id of ["abc", "-1", "1.5", "0x1", ""]) {
                const response = await fetch(`${baseUrl}/clusters/${id}`, { headers: authorized });
                expect(response.status).toBe(400);
            }
        });
    });

    describe("purge", () => {
        const purge = (body: unknown = { actorId: GUILD_ID }) =>
            fetch(`${baseUrl}/guilds/${GUILD_ID}/purge`, {
                method: "POST",
                headers: { ...authorized, "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

        it("passes the operator to the handler and reports the purge", async () => {
            const purgeGuild = vi.fn(async () => "purged" as const);
            await start(fakeHandlers({ purgeGuild }));

            const response = await purge();

            expect(purgeGuild).toHaveBeenCalledWith(GUILD_ID, { actorId: GUILD_ID });
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true, data: { purged: true } });
        });

        it("is 409 while the bot is still in the server", async () => {
            await start(fakeHandlers({ purgeGuild: async () => "in-guild" }));

            const response = await purge();

            expect(response.status).toBe(409);
            expect(((await response.json()) as { error: { code: string } }).error.code).toBe("conflict");
        });

        it("is 404 for an unknown server and 400 without an operator", async () => {
            await start(fakeHandlers({ purgeGuild: async () => null }));

            expect((await purge()).status).toBe(404);
            expect((await purge({})).status).toBe(400);
        });
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
