import { timingSafeEqual } from "node:crypto";
import { MessageFlags } from "discord.js";
import express, { type Express, type Request, type Response } from "express";
import type { Config } from "../Infrastructure/ConfigSchema";
import { logger, logModules } from "../Logging/logger";
import { ContainerBuilder } from "./ContainerBuilder";
import { linkingService } from "./LinkingService";
import type { MuteService } from "./MuteService";

type GameEvent = "lobby" | "game-start" | "meeting-start" | "meeting-end";

interface EventBody {
    event?: unknown;
    secret?: unknown;
    players?: unknown;
    deadPlayers?: unknown;
}

export class HttpServer {
    private readonly app: Express;

    constructor(
        private readonly config: Config,
        private readonly muteService: MuteService,
    ) {
        this.app = express();
        this.app.disable("x-powered-by");
        this.app.use(express.json({ limit: "1mb" }));
        this.registerRoutes();
    }

    private validateSecret(secret: unknown): boolean {
        if (typeof secret !== "string") return false;
        try {
            const a = Buffer.from(secret);
            const b = Buffer.from(this.config.secret);
            if (a.length !== b.length) return false;
            return timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    private async handleGameEvent(event: GameEvent, players: string[], deadPlayers: string[]): Promise<void> {
        logger.debug(logModules.WebServer, `Handling game event: ${event} with ${players.length} players`);
        switch (event) {
            case "game-start":
            case "meeting-end":
                logger.debug(logModules.WebServer, "Action: Muting players");
                await this.muteService.mutePlayers(players);
                break;
            case "meeting-start":
                logger.debug(
                    logModules.WebServer,
                    `Action: Unmuting alive players (${players.length}), keeping dead muted (${deadPlayers.length})`,
                );
                await this.muteService.handleMeetingStart(players, deadPlayers);
                break;
            case "lobby":
                logger.debug(logModules.WebServer, "Action: Unmuting all players");
                await this.muteService.unmuteAll();
                break;
            default:
                logger.warn(logModules.WebServer, `Received unknown event type: ${event}`);
        }
    }

    private registerRoutes(): void {
        this.app.get("/ping", (req: Request, res: Response) => {
            const secret = req.query.secret || req.headers["x-secret"];
            if (!this.validateSecret(secret)) {
                logger.warn(logModules.WebServer, "Unauthorized ping request");
                res.status(401).json({ error: "Unauthorized" });
                return;
            }
            res.status(200).json({ status: "ok", timestamp: Date.now() });
        });

        const eventRoutes: { path: string; event: GameEvent }[] = [
            { path: "/lobby", event: "lobby" },
            { path: "/game-start", event: "game-start" },
            { path: "/meeting-start", event: "meeting-start" },
            { path: "/meeting-end", event: "meeting-end" },
        ];

        for (const { path, event } of eventRoutes) {
            this.app.post(path, async (req: Request, res: Response) => {
                const body = req.body as EventBody;

                if (!this.validateSecret(body.secret)) {
                    logger.warn(logModules.WebServer, `Unauthorized request to POST ${path}`);
                    res.status(401).json({ error: "Unauthorized" });
                    return;
                }

                const players = Array.isArray(body.players) ? (body.players as string[]) : [];
                const deadPlayers = Array.isArray(body.deadPlayers) ? (body.deadPlayers as string[]) : [];
                logger.info(logModules.WebServer, `Event received: ${event} (${players.length} players)`);

                try {
                    await this.handleGameEvent(event, players, deadPlayers);
                    res.status(200).json({ status: "ok" });
                } catch (error) {
                    logger.error(logModules.WebServer, `Error handling event ${event}`, error);
                    res.status(500).json({ error: "Internal Server Error" });
                }
            });
        }

        this.app.post("/link-chat", (req: Request, res: Response) => {
            const body = req.body as { secret?: unknown; phrase?: unknown; accountName?: unknown };

            if (!this.validateSecret(body.secret)) {
                logger.warn(logModules.WebServer, "Unauthorized request to POST /link-chat");
                res.status(401).json({ error: "Unauthorized" });
                return;
            }

            if (typeof body.phrase !== "string" || typeof body.accountName !== "string") {
                res.status(400).json({ error: "Missing phrase or accountName" });
                return;
            }

            const confirmedLink = linkingService.confirmLink(body.phrase, body.accountName);
            if (confirmedLink) {
                logger.info(
                    logModules.WebServer,
                    `Link confirmed: "${body.accountName}" → Discord ${confirmedLink.discordId}`,
                );
                void this.updateOriginalLinkReply(confirmedLink);
                res.status(200).json({ status: "linked", discordId: confirmedLink.discordId });
            } else {
                logger.warn(logModules.WebServer, `No pending link found for phrase "${body.phrase}"`);
                res.status(200).json({ status: "not_found" });
            }
        });

        this.app.post("/plugin-log", (req: Request, res: Response) => {
            const body = req.body as { secret?: unknown; level?: unknown; source?: unknown; message?: unknown };

            if (!this.validateSecret(body.secret)) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }

            if (typeof body.message !== "string") {
                res.status(400).json({ error: "Missing message" });
                return;
            }

            const level = typeof body.level === "string" ? body.level.toLowerCase() : "info";
            const source = typeof body.source === "string" ? body.source : "Plugin";
            const msg = `[${source}] ${body.message}`;

            switch (level) {
                case "debug":
                    logger.debug(logModules.AmongUs, msg);
                    break;
                case "warning":
                    logger.warn(logModules.AmongUs, msg);
                    break;
                case "error":
                case "fatal":
                    logger.error(logModules.AmongUs, msg);
                    break;
                default:
                    logger.info(logModules.AmongUs, msg);
            }

            res.status(200).json({ status: "ok" });
        });

        this.app.use((_req: Request, res: Response) => {
            res.status(404).json({ error: "Not Found" });
        });
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = this.app.listen(this.config.botPort, this.config.botIp, () => {
                logger.success(
                    logModules.WebServer,
                    `HTTP server running on ${this.config.botIp}:${this.config.botPort}`,
                );
                resolve();
            });

            server.on("error", (error: NodeJS.ErrnoException) => {
                logger.error(logModules.WebServer, "Failed to start HTTP server", error);
                reject(error);
            });
        });
    }

    private async updateOriginalLinkReply(link: {
        discordId: string;
        accountName: string;
        applicationId?: string;
        interactionToken?: string;
    }): Promise<void> {
        if (!link.applicationId || !link.interactionToken) {
            logger.warn(
                logModules.WebServer,
                `Cannot update original /link reply for Discord ${link.discordId}: missing interaction webhook data`,
            );
            return;
        }

        const container = new ContainerBuilder()
            .title("Link Complete", "✅")
            .divider()
            .text(
                `Your Discord account is now linked.\n\n**Discord ID:** \`${link.discordId}\`\n**Among Us Account:** \`${link.accountName}\``,
            )
            .success();

        try {
            const response = await fetch(
                `https://discord.com/api/v10/webhooks/${link.applicationId}/${link.interactionToken}/messages/@original`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        content: " ",
                        components: [container.toJSON()],
                        flags: MessageFlags.IsComponentsV2,
                    }),
                },
            );

            if (!response.ok) {
                const body = await response.text();
                logger.warn(
                    logModules.WebServer,
                    `Failed to update original /link reply for Discord ${link.discordId}: HTTP ${response.status} ${body}`,
                );
            }
        } catch (error) {
            logger.error(
                logModules.WebServer,
                `Failed to update original /link reply for Discord ${link.discordId}`,
                error,
            );
        }
    }
}
