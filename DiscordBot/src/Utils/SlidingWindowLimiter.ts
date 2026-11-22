/** Counts the recent hits of each key and refuses a key once it reached the limit within the window. */
export class SlidingWindowLimiter<K> {
    private readonly hits = new Map<K, number[]>();

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
    ) {}

    /** Records a hit and returns true, or returns false without recording when the key is at its limit. */
    tryHit(key: K, now: number = Date.now()): boolean {
        this.forgetOlderThan(now - this.windowMs);
        const times = this.hits.get(key) ?? [];
        if (times.length >= this.limit) return false;
        this.hits.set(key, [...times, now]);
        return true;
    }

    forget(key: K): void {
        this.hits.delete(key);
    }

    /** Old keys are dropped as well, so the map never grows beyond the keys of one window. */
    private forgetOlderThan(cutoff: number): void {
        for (const [key, times] of this.hits) {
            const recent = times.filter((time) => time > cutoff);
            if (recent.length > 0) this.hits.set(key, recent);
            else this.hits.delete(key);
        }
    }
}
