/** The plugin sessions per guild that are running a game; several games can run in one guild at once. */
export class ActiveSessions {
    private readonly byGuild = new Map<string, Set<string>>();

    add(guildId: string, sessionId: string): void {
        const sessions = this.byGuild.get(guildId) ?? new Set<string>();
        sessions.add(sessionId);
        this.byGuild.set(guildId, sessions);
    }

    delete(guildId: string, sessionId: string): void {
        const sessions = this.byGuild.get(guildId);
        sessions?.delete(sessionId);
        if (sessions?.size === 0) this.byGuild.delete(guildId);
    }

    of(guildId: string): string[] {
        return [...(this.byGuild.get(guildId) ?? [])];
    }

    /** A ledger row without a session (null) belongs to no running game. */
    has(guildId: string, sessionId: string | null): boolean {
        return sessionId !== null && (this.byGuild.get(guildId)?.has(sessionId) ?? false);
    }
}
