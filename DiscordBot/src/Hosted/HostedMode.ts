import type { Config } from "../Infrastructure/ConfigSchema";

const MIN_ADMIN_TOKEN_LENGTH = 32;

export function isHosted(config: Pick<Config, "mode">): boolean {
    return config.mode === "hosted";
}

export function readAdminApiToken(env: Record<string, string | undefined>): string {
    const token = env.ADMIN_API_TOKEN?.trim();
    if (token === undefined || token.length < MIN_ADMIN_TOKEN_LENGTH) {
        throw new Error(`ADMIN_API_TOKEN must be set to at least ${MIN_ADMIN_TOKEN_LENGTH} characters in hosted mode`);
    }
    return token;
}

/** The hosted bot keeps every guild's data in one shared Postgres database. */
export function assertHostedDatabase(config: Pick<Config, "databaseDialect">): void {
    if (config.databaseDialect !== "postgres") {
        throw new Error('databaseDialect must be "postgres" (with databaseUrl) in hosted mode');
    }
}
