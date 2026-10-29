export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    pre: string | null;
}

const VERSION = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(raw: string): ParsedVersion | null {
    const match = VERSION.exec(raw.trim());
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        pre: match[4] ?? null,
    };
}

function comparePre(a: string, b: string): number {
    const left = a.split(".");
    const right = b.split(".");
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const x = left[i];
        const y = right[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const xNum = /^\d+$/.test(x);
        const yNum = /^\d+$/.test(y);
        if (xNum && yNum) {
            if (Number(x) !== Number(y)) return Number(x) - Number(y);
        } else if (xNum !== yNum) {
            return xNum ? -1 : 1;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return 0;
}

export function isNewer(candidate: string, current: string): boolean {
    const a = parseVersion(candidate);
    const b = parseVersion(current);
    if (!a || !b) return false;
    if (a.major !== b.major) return a.major > b.major;
    if (a.minor !== b.minor) return a.minor > b.minor;
    if (a.patch !== b.patch) return a.patch > b.patch;
    if (a.pre === b.pre) return false;
    if (a.pre === null) return true;
    if (b.pre === null) return false;
    return comparePre(a.pre, b.pre) > 0;
}
