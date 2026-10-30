/**
 * Guilds the bot is leaving. Two leaves of one guild can overlap (an admin block and an automatic leave), so a
 * guild stays marked until every leave that entered has exited.
 */
export class LeavingGuilds {
    private readonly leaves = new Map<string, number>();

    enter(guildId: string): void {
        this.leaves.set(guildId, (this.leaves.get(guildId) ?? 0) + 1);
    }

    exit(guildId: string): void {
        const remaining = (this.leaves.get(guildId) ?? 0) - 1;
        if (remaining > 0) this.leaves.set(guildId, remaining);
        else this.leaves.delete(guildId);
    }

    has(guildId: string): boolean {
        return this.leaves.has(guildId);
    }
}
