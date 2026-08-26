import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Config } from "../Infrastructure/ConfigSchema";
import { logger, logModules } from "../Logging/logger";

interface LinkPendingMessage {
    type: "link-pending";
    phrase: string;
    quickChatCode: string;
    discordId: string;
}

class PluginSocket {
    private wss: WebSocketServer | null = null;
    private socket: WebSocket | null = null;

    attach(server: Server, config: Config): void {
        this.wss = new WebSocketServer({ noServer: true });

        server.on("upgrade", (req, socket, head) => {
            const url = new URL(req.url ?? "", "http://localhost");
            if (url.pathname !== "/ws" || url.searchParams.get("secret") !== config.secret) {
                socket.destroy();
                return;
            }

            this.wss?.handleUpgrade(req, socket, head, (ws) => {
                this.socket?.close();
                this.socket = ws;
                logger.success(logModules.WebServer, "Plugin connected via WebSocket");

                ws.on("close", () => {
                    if (this.socket === ws) this.socket = null;
                    logger.warn(logModules.WebServer, "Plugin WebSocket disconnected");
                });

                ws.on("error", (error) => {
                    logger.error(logModules.WebServer, "Plugin WebSocket error", error);
                });
            });
        });
    }

    isConnected(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    sendLinkPending(phrase: string, quickChatCode: string, discordId: string): boolean {
        if (!this.isConnected()) return false;
        const message: LinkPendingMessage = { type: "link-pending", phrase, quickChatCode, discordId };
        this.socket?.send(JSON.stringify(message));
        return true;
    }
}

export const pluginSocket = new PluginSocket();
