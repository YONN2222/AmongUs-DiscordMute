import { createServer, type Server, type ServerResponse } from "node:http";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

/** Plain HTTP only serves the health check; the plugin talks over the WebSocket upgrade on the same server. */
export function createGatewayHttpServer(): Server {
    return createServer((req, res) => {
        const pathname = new URL(req.url ?? "", "http://localhost").pathname;
        if (req.method === "GET" && pathname === "/health") {
            sendJson(res, 200, { status: "ok" });
            return;
        }
        sendJson(res, 404, { error: "Not Found" });
    });
}
