import pg from "pg";
import { Sequelize } from "sequelize";
import { SequelizeStorage, Umzug } from "umzug";
import type { Config } from "../Infrastructure/ConfigSchema";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { initialMigration } from "./migrations/0001-initial";
import { guildSettingsMigration } from "./migrations/0002-guild-settings";
import { pendingLinkLocaleMigration } from "./migrations/0003-pending-link-locale";
import { initGuildSettingsModel } from "./models/GuildSettingsModel";
import { initLinkModel } from "./models/LinkModel";
import { initMuteLedgerModel } from "./models/MuteLedgerModel";
import { initPendingLinkModel } from "./models/PendingLinkModel";
import { createGuildSettingsRepository, type GuildSettingsRepository } from "./repositories/GuildSettingsRepository";
import { createLinkRepository, type LinkRepository } from "./repositories/LinkRepository";
import { createMuteLedgerRepository, type MuteLedgerRepository } from "./repositories/MuteLedgerRepository";
import { createPendingLinkRepository, type PendingLinkRepository } from "./repositories/PendingLinkRepository";

export interface Database {
    sequelize: Sequelize;
    links: LinkRepository;
    pendingLinks: PendingLinkRepository;
    muteLedger: MuteLedgerRepository;
    settings: GuildSettingsRepository;
    close(): Promise<void>;
}

export type DatabaseOptions = { dialect: "sqlite"; storage: string } | { dialect: "postgres"; url: string };

export function databaseOptionsFrom(
    config: Pick<Config, "databaseDialect" | "databaseUrl" | "sqlitePath">,
): DatabaseOptions {
    return config.databaseDialect === "postgres"
        ? { dialect: "postgres", url: config.databaseUrl as string }
        : { dialect: "sqlite", storage: config.sqlitePath };
}

function createSequelize(opts: DatabaseOptions): Sequelize {
    if (opts.dialect === "postgres") {
        // Passed in directly so `bun build --compile` bundles pg instead of Sequelize requiring it at runtime.
        return new Sequelize(opts.url, { dialect: "postgres", dialectModule: pg, logging: false });
    }
    return new Sequelize({
        dialect: "sqlite",
        dialectModule: bunSqliteDriver,
        storage: opts.storage,
        logging: false,
        // A single connection keeps ":memory:" databases coherent across queries.
        pool: { max: 1, min: 1, idle: Number.POSITIVE_INFINITY },
    });
}

async function runMigrations(sequelize: Sequelize): Promise<void> {
    const umzug = new Umzug({
        migrations: [initialMigration, guildSettingsMigration, pendingLinkLocaleMigration],
        context: sequelize.getQueryInterface(),
        storage: new SequelizeStorage({ sequelize, tableName: "schema_migrations" }),
        logger: undefined,
    });
    await umzug.up();
}

export interface OpenDatabaseSettings {
    /** Only one process per deployment should migrate; others open with migrate: false. */
    migrate?: boolean;
}

export async function openDatabase(
    opts: DatabaseOptions,
    { migrate = true }: OpenDatabaseSettings = {},
): Promise<Database> {
    const sequelize = createSequelize(opts);
    try {
        await sequelize.authenticate();
        if (migrate) await runMigrations(sequelize);
    } catch (err) {
        await sequelize.close();
        throw err;
    }
    const linkModel = initLinkModel(sequelize);
    const pendingLinkModel = initPendingLinkModel(sequelize);
    const muteLedgerModel = initMuteLedgerModel(sequelize);
    const guildSettingsModel = initGuildSettingsModel(sequelize);

    return {
        sequelize,
        links: createLinkRepository(linkModel),
        pendingLinks: createPendingLinkRepository(pendingLinkModel),
        muteLedger: createMuteLedgerRepository(muteLedgerModel),
        settings: createGuildSettingsRepository(guildSettingsModel),
        close: () => sequelize.close(),
    };
}
