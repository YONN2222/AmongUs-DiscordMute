import { createHash, randomBytes } from "node:crypto";

export const SECRET_PREFIX = "dmh_";
const SECRET_BYTES = 32;
/** Generated secrets are far shorter; anything longer is rejected before it reaches the database. */
const MAX_SECRET_LENGTH = 64;

export function generateSecret(): string {
    return SECRET_PREFIX + randomBytes(SECRET_BYTES).toString("base64url");
}

/** Plain sha256 is enough: the secret carries 256 bits of entropy, so there is nothing to brute-force. */
export function hashSecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
}

/** Whether the value can be a secret made by `generateSecret`, so anything else never reaches the database. */
export function hasSecretFormat(secret: string): boolean {
    return secret.startsWith(SECRET_PREFIX) && secret.length <= MAX_SECRET_LENGTH;
}
