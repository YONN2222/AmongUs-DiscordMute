import { type ClusterRequest, type GatewayRequest, type RouterReply, toRouterReply } from "./messages";

const REQUEST_TIMEOUT_MS = 10000;

export interface ClusterRouter {
    send(guildId: string, req: ClusterRequest): Promise<RouterReply>;
}

export interface GatewayLink {
    send(req: GatewayRequest): Promise<RouterReply>;
}

export interface GalacticInstanceLike {
    sendRequestToClusterOfGuild(guildID: string, message: unknown, timeout?: number): Promise<unknown>;
}

export interface GalacticClusterLike {
    sendRequest(data: unknown, timeout?: number): Promise<unknown>;
}

function failure(error: unknown): RouterReply {
    return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
    };
}

export class GalacticClusterRouter implements ClusterRouter {
    constructor(private readonly instance: GalacticInstanceLike) {}

    async send(guildId: string, req: ClusterRequest): Promise<RouterReply> {
        try {
            return toRouterReply(await this.instance.sendRequestToClusterOfGuild(guildId, req, REQUEST_TIMEOUT_MS));
        } catch (error) {
            return failure(error);
        }
    }
}

export class GalacticGatewayLink implements GatewayLink {
    constructor(private readonly cluster: GalacticClusterLike) {}

    async send(req: GatewayRequest): Promise<RouterReply> {
        try {
            return toRouterReply(await this.cluster.sendRequest(req));
        } catch (error) {
            return failure(error);
        }
    }
}

export interface SentClusterRequest {
    guildId: string;
    req: ClusterRequest;
}

export class InMemoryClusterRouter implements ClusterRouter {
    readonly sent: SentClusterRequest[] = [];
    private readonly handlers = new Map<string, (req: ClusterRequest) => Promise<RouterReply>>();

    register(guildId: string, handler: (req: ClusterRequest) => Promise<RouterReply>): void {
        this.handlers.set(guildId, handler);
    }

    async send(guildId: string, req: ClusterRequest): Promise<RouterReply> {
        this.sent.push({ guildId, req });
        const handler = this.handlers.get(guildId);
        return handler ? handler(req) : { ok: false, error: "no handler" };
    }
}

export class InMemoryGatewayLink implements GatewayLink {
    readonly sent: GatewayRequest[] = [];
    private readonly handlers = new Map<string, (req: GatewayRequest) => Promise<RouterReply>>();

    register(guildId: string, handler: (req: GatewayRequest) => Promise<RouterReply>): void {
        this.handlers.set(guildId, handler);
    }

    async send(req: GatewayRequest): Promise<RouterReply> {
        this.sent.push(req);
        const handler = this.handlers.get(req.guildId);
        return handler ? handler(req) : { ok: false, error: "no handler" };
    }
}
