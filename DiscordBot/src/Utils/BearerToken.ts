import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const BEARER_PREFIX = "Bearer ";

function sha256(value: string): Buffer {
    return createHash("sha256").update(value).digest();
}

/** Constant-time check of the Authorization header against the expected token. */
export function hasBearerToken(request: IncomingMessage, token: string): boolean {
    const header = request.headers.authorization ?? "";
    if (!header.startsWith(BEARER_PREFIX)) return false;
    return timingSafeEqual(sha256(header.slice(BEARER_PREFIX.length)), sha256(token));
}
