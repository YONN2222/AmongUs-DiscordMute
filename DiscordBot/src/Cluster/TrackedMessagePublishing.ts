import type { TrackedMessage } from "../Data/Repositories/TrackedMessageRepository";
import { classifyDiscordError, type MessagePayload, type MessagePort, type PostFailure } from "./MessagePort";

/**
 * Edits the tracked message, or posts a new one when there is none or Discord no longer knows it. Resolves to the
 * id of the posted message, or null when the tracked one was edited. Any other Discord error rejects.
 */
export async function editOrPost(
    port: MessagePort,
    tracked: TrackedMessage | null,
    channelId: string,
    payload: MessagePayload,
): Promise<string | null> {
    if (tracked) {
        try {
            await port.edit(tracked.channelId, tracked.messageId, payload);
            return null;
        } catch (error) {
            if (classifyDiscordError(error) !== "unknown-message") throw error;
        }
    }
    return port.post(channelId, payload);
}

export type UnusableChannelFailure = Extract<PostFailure, "missing-access" | "unknown-channel">;

/** The failures only an admin can fix (channel gone or no access); null for any other error. */
export function unusableChannelFailure(error: unknown): UnusableChannelFailure | null {
    const failure = classifyDiscordError(error);
    return failure === "missing-access" || failure === "unknown-channel" ? failure : null;
}

export interface ThrottledRefreshOptions {
    minIntervalMs: number;
    now: () => number;
    /** Must never reject. */
    refresh: () => Promise<void>;
}

/**
 * Runs one message's refreshes one after another, at most one per interval. A request that comes in while a
 * refresh runs is remembered, so the last request is always honoured.
 */
export class ThrottledRefresh {
    private chain: Promise<void> = Promise.resolve();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private inFlight = 0;
    private dirty = false;
    private lastRefreshAt = Number.NEGATIVE_INFINITY;
    private stopped = false;

    constructor(private readonly options: ThrottledRefreshOptions) {}

    /** Refreshes once the interval since the last refresh has passed. */
    request(): void {
        if (this.timer || this.stopped) return;
        if (this.inFlight > 0) {
            this.dirty = true;
            return;
        }
        const delay = Math.max(0, this.lastRefreshAt + this.options.minIntervalMs - this.options.now());
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.run();
        }, delay);
        this.timer.unref?.();
    }

    /** Refreshes right away, ignoring the interval, after the refresh in progress; resolves once it is done. */
    async run(): Promise<void> {
        this.inFlight += 1;
        this.dirty = false;
        const task = this.chain.then(() => this.options.refresh());
        this.chain = task;
        try {
            await task;
        } finally {
            this.inFlight -= 1;
            this.lastRefreshAt = this.options.now();
            if (this.dirty && this.inFlight === 0) this.request();
        }
    }

    /** Drops a waiting refresh and every later request; `last` runs once the refresh in progress is done. */
    stop(last: () => Promise<void>): Promise<void> {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.chain = this.chain.then(last);
        return this.chain;
    }
}
