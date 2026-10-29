/** Runs tasks one after another per guild; a failing task never blocks the ones queued behind it. */
export class GuildQueue {
    private readonly queues = new Map<string, Promise<void>>();

    run<T>(guildId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.queues.get(guildId) ?? Promise.resolve();
        const run = previous.then(task);
        const tail = run.then(
            () => {},
            () => {},
        );
        this.queues.set(guildId, tail);
        void tail.then(() => {
            if (this.queues.get(guildId) === tail) this.queues.delete(guildId);
        });
        return run;
    }
}
