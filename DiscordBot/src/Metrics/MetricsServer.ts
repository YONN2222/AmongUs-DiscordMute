import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { logger, logModules } from "../Logging/Logger";
import { hasBearerToken } from "../Utils/BearerToken";
import type { MetricsCollector } from "./MetricsCollector";

function isAuthorized(request: IncomingMessage, token: string | undefined): boolean {
    return token === undefined || hasBearerToken(request, token);
}

function end(response: ServerResponse, status: number): void {
    response.writeHead(status).end();
}

export function createMetricsServer(deps: { collector: MetricsCollector; token?: string }): Server {
    return createServer((request, response) => {
        const path = (request.url ?? "").split("?")[0];
        if (request.method !== "GET" || path !== "/metrics") return end(response, 404);
        if (!isAuthorized(request, deps.token)) return end(response, 401);

        deps.collector
            .aggregated()
            .then(async (registry) => {
                const body = await registry.metrics();
                response.writeHead(200, { "Content-Type": registry.contentType }).end(body);
            })
            .catch((error: unknown) => {
                logger.error(logModules.Metrics, "Could not collect metrics", error);
                if (!response.headersSent) end(response, 500);
            });
    });
}
