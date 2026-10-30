import { createHash, randomBytes } from "node:crypto";

export const SECRET_PREFIX = "dmh_";
const SECRET_BYTES = 32;

export function generateSecret(): string {
    return SECRET_PREFIX + randomBytes(SECRET_BYTES).toString("base64url");
}

/** Plain sha256 is enough: the secret carries 256 bits of entropy, so there is nothing to brute-force. */
export function hashSecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
}
