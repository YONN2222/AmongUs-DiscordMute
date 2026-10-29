const PIPE = " | ";

export function normalizeAccountName(name: string): string {
    return name.trim().toLowerCase();
}

/** A stored "Prefix | Name" also answers to "Name". */
export function accountNameKeys(stored: string): string[] {
    const full = normalizeAccountName(stored);
    const pipeAt = stored.lastIndexOf(PIPE);
    if (pipeAt === -1) return [full];
    const suffix = normalizeAccountName(stored.slice(pipeAt + PIPE.length));
    return suffix && suffix !== full ? [full, suffix] : [full];
}

export function matchesAccountName(stored: string, name: string): boolean {
    return accountNameKeys(stored).includes(normalizeAccountName(name));
}
