import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { logger, logModules } from "../Logging/Logger";
import { hasBearerToken } from "../Utils/BearerToken";
import type { AdminHandlers, Page } from "./AdminHandlers";
import {
    ADMIN_API_PREFIX,
    ADMIN_ERROR_STATUS,
    type AdminErrorCode,
    type AdminResponse,
    AuditListQuerySchema,
    BlockListQuerySchema,
    BlockTypeSchema,
    CreateAuditBodySchema,
    CreateBlockBodySchema,
    GuildListQuerySchema,
    LeaveGuildBodySchema,
    MAX_BODY_BYTES,
    type PageMeta,
    type PageQuery,
    PurgeGuildBodySchema,
    RemoveBlockBodySchema,
    SnowflakeSchema,
} from "./Contract";

const INTERNAL_ERROR_MESSAGE = "Internal error";

class AdminRequestError extends Error {
    constructor(
        readonly code: AdminErrorCode,
        message: string,
    ) {
        super(message);
    }
}

interface Reply {
    status: number;
    data: unknown;
    meta?: PageMeta;
}

interface RouteRequest {
    params: Record<string, string>;
    query: Record<string, string>;
    readBody(): Promise<unknown>;
}

interface Route {
    method: string;
    segments: string[];
    run(request: RouteRequest): Promise<Reply>;
}

function send(response: ServerResponse, status: number, body: AdminResponse<unknown>): void {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}

function fail(code: AdminErrorCode, message: string): AdminRequestError {
    return new AdminRequestError(code, message);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    const field = issue?.path.join(".") || "body";
    throw fail("invalid-request", `Invalid value for "${field}": ${issue?.message ?? "invalid"}`);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const tooLarge = fail("payload-too-large", `Body is larger than ${MAX_BODY_BYTES} bytes`);
        if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) return reject(tooLarge);

        const chunks: Buffer[] = [];
        let size = 0;
        let rejected = false;
        request.on("data", (chunk: Buffer) => {
            if (rejected) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                rejected = true;
                reject(tooLarge);
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => {
            if (rejected) return;
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(fail("invalid-request", "Body must be valid JSON"));
            }
        });
        request.on("error", reject);
    });
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
    if (pattern.length !== actual.length) return null;
    const params: Record<string, string> = {};
    for (const [index, segment] of pattern.entries()) {
        const value = actual[index] as string;
        if (segment.startsWith(":")) params[segment.slice(1)] = value;
        else if (segment !== value) return null;
    }
    return params;
}

function ok(data: unknown, status = 200): Reply {
    return { status, data };
}

function pageOf<T>(query: PageQuery, page: Page<T>): Reply {
    return { status: 200, data: page.rows, meta: { total: page.total, page: query.page, limit: query.limit } };
}

const GuildParamsSchema = z.object({ guildId: SnowflakeSchema });
const BlockParamsSchema = z.object({ type: BlockTypeSchema, targetId: SnowflakeSchema });

function buildRoutes(handlers: AdminHandlers): Route[] {
    const route = (method: string, path: string, run: Route["run"]): Route => ({
        method,
        segments: path.split("/").slice(1),
        run,
    });

    return [
        route("GET", "/health", async () => ok(await handlers.health())),
        route("GET", "/overview", async () => ok(await handlers.overview())),
        route("GET", "/guilds", async ({ query }) => {
            const parsed = parse(GuildListQuerySchema, query);
            return pageOf(parsed, await handlers.listGuilds(parsed));
        }),
        route("GET", "/guilds/:guildId", async ({ params }) => {
            const guild = await handlers.getGuild(parse(GuildParamsSchema, params).guildId);
            if (!guild) throw fail("not-found", "Server not found");
            return ok(guild);
        }),
        route("POST", "/guilds/:guildId/leave", async ({ params, readBody }) => {
            const { guildId } = parse(GuildParamsSchema, params);
            const result = await handlers.leaveGuild(guildId, parse(LeaveGuildBodySchema, await readBody()));
            if (!result) throw fail("not-found", "Server not found");
            return ok(result);
        }),
        route("POST", "/guilds/:guildId/purge", async ({ params, readBody }) => {
            const { guildId } = parse(GuildParamsSchema, params);
            const result = await handlers.purgeGuild(guildId, parse(PurgeGuildBodySchema, await readBody()));
            if (!result) throw fail("not-found", "Server not found");
            if (result === "in-guild") throw fail("conflict", "The bot is still in this server");
            return ok({ purged: true });
        }),
        route("GET", "/blocks", async ({ query }) => {
            const parsed = parse(BlockListQuerySchema, query);
            return pageOf(parsed, await handlers.listBlocks(parsed));
        }),
        route("POST", "/blocks", async ({ readBody }) => {
            const block = await handlers.createBlock(parse(CreateBlockBodySchema, await readBody()));
            if (block === "conflict") throw fail("conflict", "This target is already blocked");
            return ok(block, 201);
        }),
        route("DELETE", "/blocks/:type/:targetId", async ({ params, readBody }) => {
            const { type, targetId } = parse(BlockParamsSchema, params);
            const removed = await handlers.removeBlock(type, targetId, parse(RemoveBlockBodySchema, await readBody()));
            if (!removed) throw fail("not-found", "Block not found");
            return ok({ removed: true });
        }),
        route("GET", "/audit", async ({ query }) => {
            const parsed = parse(AuditListQuerySchema, query);
            return pageOf(parsed, await handlers.listAudit(parsed));
        }),
        route("POST", "/audit", async ({ readBody }) =>
            ok(await handlers.recordDashboardAudit(parse(CreateAuditBodySchema, await readBody())), 201),
        ),
    ];
}

function findRoute(routes: Route[], method: string, pathname: string): [Route, Record<string, string>] | null {
    if (!pathname.startsWith(`${ADMIN_API_PREFIX}/`)) return null;
    const actual = pathname.slice(ADMIN_API_PREFIX.length).split("/").slice(1);
    for (const route of routes) {
        if (route.method !== method) continue;
        const params = matchSegments(route.segments, actual);
        if (params) return [route, params];
    }
    return null;
}

/** Internal HTTP API for the admin dashboard. Every request needs the bearer token. */
export function createAdminServer(deps: { token: string; handlers: AdminHandlers }): Server {
    const routes = buildRoutes(deps.handlers);

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (!hasBearerToken(request, deps.token)) throw fail("unauthorized", "Missing or invalid token");
        const url = new URL(request.url ?? "", "http://localhost");
        const match = findRoute(routes, request.method ?? "", url.pathname);
        if (!match) throw fail("not-found", "Unknown endpoint");
        const [route, params] = match;
        const reply = await route.run({
            params,
            query: Object.fromEntries(url.searchParams),
            readBody: () => readJsonBody(request),
        });
        send(response, reply.status, { ok: true, data: reply.data, ...(reply.meta && { meta: reply.meta }) });
    }

    return createServer((request, response) => {
        handle(request, response).catch((error: unknown) => {
            if (error instanceof AdminRequestError) {
                if (error.code === "payload-too-large") response.setHeader("Connection", "close");
                send(response, ADMIN_ERROR_STATUS[error.code], {
                    ok: false,
                    error: { code: error.code, message: error.message },
                });
                return;
            }
            logger.error(logModules.WebServer, `Admin API ${request.method} request failed`, error);
            send(response, ADMIN_ERROR_STATUS.internal, {
                ok: false,
                error: { code: "internal", message: INTERNAL_ERROR_MESSAGE },
            });
        });
    });
}
