import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GuildEvent, GuildEventBus } from "../../src/Events/GuildEvents";
import { logger } from "../../src/Logging/Logger";

const event: GuildEvent = { type: "session-ended", guildId: "g", sessionId: "s" };

describe("GuildEventBus", () => {
    beforeEach(() => {
        vi.spyOn(logger, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("delivers an event to every handler", async () => {
        const bus = new GuildEventBus();
        const first = vi.fn();
        const second = vi.fn();
        bus.on(first);
        bus.on(second);

        bus.emit(event);

        await vi.waitFor(() => expect(second).toHaveBeenCalledWith(event));
        expect(first).toHaveBeenCalledWith(event);
    });

    it("still runs the next handler when one throws or rejects, and logs the failures", async () => {
        const bus = new GuildEventBus();
        const after = vi.fn();
        bus.on(() => {
            throw new Error("sync boom");
        });
        bus.on(async () => {
            throw new Error("async boom");
        });
        bus.on(after);

        expect(() => bus.emit(event)).not.toThrow();

        await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(2));
        expect(after).toHaveBeenCalledWith(event);
    });

    it("returns before an async handler resolves", async () => {
        const bus = new GuildEventBus();
        let release = (): void => {};
        let finished = false;
        bus.on(async () => {
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            finished = true;
        });

        bus.emit(event);
        expect(finished).toBe(false);

        await vi.waitFor(() => expect(release).not.toBe(undefined));
        release();
        await vi.waitFor(() => expect(finished).toBe(true));
    });

    it("stops delivering to a handler after it unsubscribed", async () => {
        const bus = new GuildEventBus();
        const kept = vi.fn();
        const removed = vi.fn();
        bus.on(kept);
        const off = bus.on(removed);
        off();

        bus.emit(event);

        await vi.waitFor(() => expect(kept).toHaveBeenCalled());
        expect(removed).not.toHaveBeenCalled();
    });
});
