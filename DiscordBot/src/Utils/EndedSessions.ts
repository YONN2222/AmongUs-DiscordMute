/** Enough for every game that ends while a late event can still be on its way, with a fixed memory ceiling. */
const MAX_REMEMBERED_SESSIONS = 10_000;

/** The most recently ended plugin sessions, so a game event that arrives after its session ended is dropped. */
export class EndedSessions {
    /** A Set keeps insertion order, so the first entry is always the oldest. */
    private readonly sessions = new Set<string>();

    constructor(private readonly capacity = MAX_REMEMBERED_SESSIONS) {}

    add(sessionId: string): void {
        this.sessions.delete(sessionId);
        this.sessions.add(sessionId);
        if (this.sessions.size <= this.capacity) return;
        const [oldest] = this.sessions;
        this.sessions.delete(oldest);
    }

    has(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }
}
