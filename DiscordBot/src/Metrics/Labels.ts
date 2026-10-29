const VERSION_LABEL_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

export const OTHER_LABEL = "other";
export const MAX_VERSION_LABELS = 15;

export function sanitizeVersionLabel(raw: string): string {
    const trimmed = raw.trim();
    return VERSION_LABEL_PATTERN.test(trimmed) ? trimmed : OTHER_LABEL;
}

export class BoundedLabelSet {
    private readonly admitted = new Set<string>();

    constructor(private readonly max: number) {}

    admit(value: string): string {
        if (this.admitted.has(value)) return value;
        if (this.admitted.size >= this.max) return OTHER_LABEL;
        this.admitted.add(value);
        return value;
    }
}
