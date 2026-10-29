import { randomUUID } from "node:crypto";
import { QueryTypes, type Sequelize } from "sequelize";

const INSTANCE_ID_KEY = "instance_id";

export interface TelemetryRepository {
    /** Concurrent callers, also across processes, all get the id of the first insert. */
    getOrCreateInstanceId(): Promise<string>;
    /** Distinct Discord users with a link in any guild. */
    countLinkedUsers(): Promise<number>;
}

export function createTelemetryRepository(sequelize: Sequelize): TelemetryRepository {
    return {
        async getOrCreateInstanceId() {
            await sequelize.query(
                "INSERT INTO bot_meta (key, value) VALUES (:key, :value) ON CONFLICT (key) DO NOTHING",
                {
                    replacements: { key: INSTANCE_ID_KEY, value: randomUUID() },
                },
            );
            const rows = await sequelize.query<{ value: string }>("SELECT value FROM bot_meta WHERE key = :key", {
                replacements: { key: INSTANCE_ID_KEY },
                type: QueryTypes.SELECT,
            });
            const value = rows[0]?.value;
            if (!value) throw new Error("instance id missing after insert");
            return value;
        },
        async countLinkedUsers() {
            const rows = await sequelize.query<{ total: number | string }>(
                "SELECT COUNT(DISTINCT discord_id) AS total FROM links",
                { type: QueryTypes.SELECT },
            );
            return Number(rows[0]?.total ?? 0);
        },
    };
}
