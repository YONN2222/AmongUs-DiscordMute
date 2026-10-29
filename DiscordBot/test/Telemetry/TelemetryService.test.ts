import { Registry } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/Logging/Logger";
import { createGatewayMetrics } from "../../src/Metrics/GatewayMetrics";
import type { ProcessSnapshot } from "../../src/Metrics/MetricsCollector";
import { telemetryPacketSchema } from "../../src/Telemetry/Contract/schema";
import { TelemetryBuilder } from "../../src/Telemetry/TelemetryBuilder";
import {
    MAX_PACKET_AGE_MS,
    TELEMETRY_INTERVAL_MS,
    TELEMETRY_URL,
    TelemetryService,
    telemetryTarget,
} from "../../src/Telemetry/TelemetryService";
import { BOT_VERSION } from "../../src/Version";

const INSTANCE_ID = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8d0b7a41";

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const accepted = () => json(202, { ok: true, status: "accepted" });
const duplicate = () => json(200, { ok: true, status: "duplicate" });
const failure = (status: number, error: string) => json(status, { ok: false, error });

let lobbyEvents = 0;

async function collect(): Promise<ProcessSnapshot[]> {
    const registry = new Registry();
    const metrics = createGatewayMetrics(registry);
    if (lobbyEvents > 0) metrics.pluginEvents.inc({ type: "lobby" }, lobbyEvents);
    return [{ source: "gateway", metrics: (await registry.getMetricsAsJSON()) as ProcessSnapshot["metrics"] }];
}

function makeBuilder(): TelemetryBuilder {
    return new TelemetryBuilder({
        instanceId: INSTANCE_ID,
        mode: "self-host",
        botVersion: "3.0.0",
        countLinkedUsers: async () => 1,
    });
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function makeService(
    fetchMock: FetchMock,
    target: { url: string; authorization?: string } = { url: "https://example.test/api/v1/telemetry" },
    builder = makeBuilder(),
) {
    const service = new TelemetryService({
        target,
        fetch: fetchMock as unknown as typeof fetch,
        collect,
        builder,
    });
    return { service, builder };
}

const sentBody = (fetchMock: FetchMock, call: number) => String(fetchMock.mock.calls[call]?.[1]?.body);
const sentPacket = (fetchMock: FetchMock, call: number) => JSON.parse(sentBody(fetchMock, call));

const baseTarget = {
    disabled: false,
    compiled: true,
    mode: "self-host" as const,
    env: {} as Record<string, string | undefined>,
};

beforeEach(() => {
    lobbyEvents = 0;
    vi.useFakeTimers();
    for (const level of ["info", "warn", "success", "debug", "error"] as const) {
        vi.spyOn(logger, level).mockImplementation(() => {});
    }
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("telemetryTarget", () => {
    it("null when disableTelemetry is true even if compiled", () => {
        expect(telemetryTarget({ ...baseTarget, disabled: true })).toBeNull();
        expect(telemetryTarget({ ...baseTarget, disabled: true, env: { DISCORDMUTE_TELEMETRY: "1" } })).toBeNull();
    });

    it("null from a source checkout without env", () => {
        expect(telemetryTarget({ ...baseTarget, compiled: false })).toBeNull();
        expect(telemetryTarget({ ...baseTarget, compiled: false, env: { DISCORDMUTE_TELEMETRY: "0" } })).toBeNull();
    });

    it("default url ends with /api/v1/telemetry", () => {
        const target = telemetryTarget(baseTarget);
        expect(target?.url).toBe(TELEMETRY_URL);
        expect(target?.url.endsWith("/api/v1/telemetry")).toBe(true);
    });

    it("env opt-in enables a source checkout", () => {
        expect(telemetryTarget({ ...baseTarget, compiled: false, env: { DISCORDMUTE_TELEMETRY: "1" } })?.url).toBe(
            TELEMETRY_URL,
        );
    });

    it("env override only with DISCORDMUTE_TELEMETRY=1", () => {
        const url = "http://localhost:8787/api/v1/telemetry";
        expect(telemetryTarget({ ...baseTarget, env: { DISCORDMUTE_TELEMETRY_URL: url } })?.url).toBe(TELEMETRY_URL);
        expect(
            telemetryTarget({ ...baseTarget, env: { DISCORDMUTE_TELEMETRY: "1", DISCORDMUTE_TELEMETRY_URL: url } })
                ?.url,
        ).toBe(url);
        expect(
            telemetryTarget({
                ...baseTarget,
                env: { DISCORDMUTE_TELEMETRY: "1", DISCORDMUTE_TELEMETRY_URL: "https://staging.example.test/t" },
            })?.url,
        ).toBe("https://staging.example.test/t");
    });

    it("rejects a non-https override", () => {
        for (const url of ["http://example.test/t", "ftp://localhost/t", "not a url"]) {
            const target = telemetryTarget({
                ...baseTarget,
                env: { DISCORDMUTE_TELEMETRY: "1", DISCORDMUTE_TELEMETRY_URL: url },
            });
            expect(target?.url).toBe(TELEMETRY_URL);
        }
    });

    it("hosted without HOSTED_TELEMETRY_TOKEN is null and warns once", () => {
        expect(telemetryTarget({ ...baseTarget, mode: "hosted" })).toBeNull();
        expect(telemetryTarget({ ...baseTarget, mode: "hosted", env: { HOSTED_TELEMETRY_TOKEN: "" } })).toBeNull();
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("hosted with token sets Bearer authorization", () => {
        const target = telemetryTarget({ ...baseTarget, mode: "hosted", env: { HOSTED_TELEMETRY_TOKEN: "abc" } });
        expect(target?.authorization).toBe("Bearer abc");
    });

    it("self-host never sets authorization", () => {
        const target = telemetryTarget({ ...baseTarget, env: { HOSTED_TELEMETRY_TOKEN: "abc" } });
        expect(target).not.toBeNull();
        expect(target).not.toHaveProperty("authorization");
    });

    it("hosted target is used from source when the token is set", () => {
        const target = telemetryTarget({
            ...baseTarget,
            compiled: false,
            mode: "hosted",
            env: { HOSTED_TELEMETRY_TOKEN: "test-hosted-token" },
        });
        expect(target).toEqual({ url: TELEMETRY_URL, authorization: "Bearer test-hosted-token" });
    });

    it("hosted without token stays off", () => {
        expect(telemetryTarget({ ...baseTarget, compiled: false, mode: "hosted" })).toBeNull();
    });

    it("hosted stays off when telemetry is disabled", () => {
        const env = { HOSTED_TELEMETRY_TOKEN: "test-hosted-token" };
        expect(telemetryTarget({ ...baseTarget, disabled: true, compiled: false, mode: "hosted", env })).toBeNull();
    });

    it("self-host from source stays off", () => {
        const env = { HOSTED_TELEMETRY_TOKEN: "test-hosted-token" };
        expect(telemetryTarget({ ...baseTarget, compiled: false, mode: "self-host", env })).toBeNull();
    });
});

describe("TelemetryService", () => {
    it("posts a schema-valid packet with json content type and user agent", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(accepted());
        const { service } = makeService(fetchMock);
        lobbyEvents = 2;

        expect(await service.tick()).toBe("accepted");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(url).toBe("https://example.test/api/v1/telemetry");
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("user-agent")).toBe(`DiscordMute-Bot/${BOT_VERSION}`);
        expect(headers.has("authorization")).toBe(false);
        const packet = telemetryPacketSchema.parse(sentPacket(fetchMock, 0));
        expect(packet.deltas.events).toEqual({ lobby: 2 });
    });

    it("no POST at startup, first after one interval", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(accepted());
        const { service } = makeService(fetchMock);

        service.start();
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(TELEMETRY_INTERVAL_MS - 1);
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        service.stop();
    });

    it("202 clears pending and the next tick builds a new packetId", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => accepted());
        const { service } = makeService(fetchMock);

        await service.tick();
        await service.tick();

        expect(sentPacket(fetchMock, 0).packetId).not.toBe(sentPacket(fetchMock, 1).packetId);
    });

    it("200 is reported as duplicate and clears pending", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(duplicate()).mockResolvedValue(accepted());
        const { service } = makeService(fetchMock);

        expect(await service.tick()).toBe("duplicate");
        await service.tick();

        expect(sentPacket(fetchMock, 0).packetId).not.toBe(sentPacket(fetchMock, 1).packetId);
    });

    it("429 then 202 resends the same packetId and body", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(failure(429, "rate_limited"))
            .mockResolvedValueOnce(accepted());
        const { service } = makeService(fetchMock);
        lobbyEvents = 3;

        expect(await service.tick()).toBe("retry-later");
        lobbyEvents = 9;
        expect(await service.tick()).toBe("accepted");

        expect(sentBody(fetchMock, 1)).toBe(sentBody(fetchMock, 0));
    });

    it("503 keeps the packet for the next tick", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(failure(503, "unavailable"))
            .mockResolvedValueOnce(accepted());
        const { service } = makeService(fetchMock);

        expect(await service.tick()).toBe("retry-later");
        expect(await service.tick()).toBe("accepted");
        expect(sentPacket(fetchMock, 1).packetId).toBe(sentPacket(fetchMock, 0).packetId);
    });

    it("a 5xx with an unreadable body is retried", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }))
            .mockResolvedValueOnce(accepted());
        const { service } = makeService(fetchMock);

        expect(await service.tick()).toBe("retry-later");
        expect(await service.tick()).toBe("accepted");
        expect(sentPacket(fetchMock, 1).packetId).toBe(sentPacket(fetchMock, 0).packetId);
    });

    it("network rejection keeps the packet and logs debug only", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockRejectedValueOnce(new TypeError("fetch failed"))
            .mockResolvedValueOnce(accepted());
        const { service } = makeService(fetchMock);

        await expect(service.tick()).resolves.toBe("retry-later");
        expect(logger.debug).toHaveBeenCalled();
        for (const level of ["info", "warn", "error", "success"] as const) expect(logger[level]).not.toHaveBeenCalled();

        await service.tick();
        expect(sentPacket(fetchMock, 1).packetId).toBe(sentPacket(fetchMock, 0).packetId);
    });

    it("422 drops the packet and the next tick sends a fresh packet whose deltas exclude the dropped window", async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(failure(422, "implausible"))
            .mockResolvedValueOnce(accepted());
        const { service } = makeService(fetchMock);
        lobbyEvents = 5;

        expect(await service.tick()).toBe("dropped");
        lobbyEvents = 7;
        expect(await service.tick()).toBe("accepted");

        expect(sentPacket(fetchMock, 0).deltas.events).toEqual({ lobby: 5 });
        expect(sentPacket(fetchMock, 1).deltas.events).toEqual({ lobby: 2 });
        expect(sentPacket(fetchMock, 1).packetId).not.toBe(sentPacket(fetchMock, 0).packetId);
    });

    it("401 drops the packet", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => failure(401, "unauthorized"));
        const { service } = makeService(fetchMock);

        expect(await service.tick()).toBe("dropped");
        await service.tick();

        expect(sentPacket(fetchMock, 1).packetId).not.toBe(sentPacket(fetchMock, 0).packetId);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("a hosted 401 warns once", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => failure(401, "unauthorized"));
        const { service } = makeService(fetchMock, { url: "https://example.test/t", authorization: "Bearer abc" });

        await service.tick();
        await service.tick();

        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("a pending packet older than 1 h is dropped without a POST and the baseline is reset", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline"));
        fetchMock.mockResolvedValue(accepted());
        const { service } = makeService(fetchMock);
        lobbyEvents = 4;

        expect(await service.tick()).toBe("retry-later");
        vi.setSystemTime(Date.now() + MAX_PACKET_AGE_MS + 1);
        lobbyEvents = 10;
        expect(await service.tick()).toBe("expired");
        expect(fetchMock).toHaveBeenCalledTimes(1);

        lobbyEvents = 11;
        expect(await service.tick()).toBe("accepted");
        expect(sentPacket(fetchMock, 1).deltas.events).toEqual({ lobby: 1 });
        expect(sentPacket(fetchMock, 1).packetId).not.toBe(sentPacket(fetchMock, 0).packetId);
    });

    it("a fetch that never resolves times out, does not block stop, and ticks never overlap", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(
            () =>
                new Promise<Response>(() => {
                    /* never answers */
                }),
        );
        const { service } = makeService(fetchMock);

        service.start();
        await vi.advanceTimersByTimeAsync(TELEMETRY_INTERVAL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        service.stop();
        await vi.advanceTimersByTimeAsync(TELEMETRY_INTERVAL_MS * 3);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const direct = makeService(fetchMock).service;
        const first = direct.tick();
        const second = direct.tick();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10000);
        expect(await first).toBe("retry-later");
        expect(await second).toBe("retry-later");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("hosted sends the Authorization header", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(accepted());
        const { service } = makeService(fetchMock, { url: "https://example.test/t", authorization: "Bearer abc" });

        await service.tick();

        expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer abc");
    });

    it("a build failure logs debug and returns retry-later", async () => {
        const fetchMock = vi.fn<typeof fetch>();
        const builder = makeBuilder();
        vi.spyOn(builder, "build").mockRejectedValue(new Error("bug"));
        const { service } = makeService(fetchMock, undefined, builder);

        expect(await service.tick()).toBe("retry-later");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalled();
    });

    it("stop clears the timer", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(accepted());
        const { service } = makeService(fetchMock);

        service.start();
        service.stop();
        await vi.advanceTimersByTimeAsync(TELEMETRY_INTERVAL_MS * 2);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
