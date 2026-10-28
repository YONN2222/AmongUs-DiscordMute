import { Sequelize } from "sequelize";
import { SequelizeStorage, Umzug } from "umzug";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { initialMigration } from "./migrations/0001-initial";
import { initLinkModel } from "./models/LinkModel";
import { initMuteLedgerModel } from "./models/MuteLedgerModel";
import { initPendingLinkModel } from "./models/PendingLinkModel";
import { createLinkRepository, type LinkRepository } from "./repositories/LinkRepository";

export interface Database {
    sequelize: Sequelize;
    links: LinkRepository;
    close(): Promise<void>;
}

export type DatabaseOptions = { dialect: "sqlite"; storage: string } | { dialect: "postgres"; url: string };

function createSequelize(opts: DatabaseOptions): Sequelize {
    if (opts.dialect === "postgres") {
        return new Sequelize(opts.url, { dialect: "postgres", logging: false });
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
        migrations: [initialMigration],
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
    initPendingLinkModel(sequelize);
    initMuteLedgerModel(sequelize);

    return {
        sequelize,
        links: createLinkRepository(linkModel),
        close: () => sequelize.close(),
    };
}
