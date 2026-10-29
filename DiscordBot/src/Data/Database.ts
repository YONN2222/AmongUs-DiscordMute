import pg from "pg";
import { Sequelize } from "sequelize";
import { SequelizeStorage, Umzug } from "umzug";
import type { Config } from "../Infrastructure/ConfigSchema";
import { bunSqliteDriver } from "./BunSqliteDriver";
import { initialMigration } from "./Migrations/0001-initial";
import { guildSettingsMigration } from "./Migrations/0002-guild-settings";
import { pendingLinkLocaleMigration } from "./Migrations/0003-pending-link-locale";
import { trackedMessagesMigration } from "./Migrations/0004-tracked-messages";
import { voiceLedgerMigration } from "./Migrations/0005-voice-ledger";
import { linkFriendCodeMigration } from "./Migrations/0006-link-friend-code";
import { nicknameLedgerMigration } from "./Migrations/0007-nickname-ledger";
import { botMetaMigration } from "./Migrations/0010-bot-meta";
import { guildSecretsMigration } from "./Migrations/0011-guild-secrets";
import { hostedGuildsMigration } from "./Migrations/0012-hosted-guilds";
import { blocksMigration } from "./Migrations/0013-blocks";
import { auditLogMigration } from "./Migrations/0014-audit-log";
import { ledgerSessionsMigration } from "./Migrations/0015-ledger-sessions";
import { hostedGuildLeftAtMigration } from "./Migrations/0016-hosted-guild-left-at";
import { initGuildSettingsModel } from "./Models/GuildSettingsModel";
import { initLinkModel } from "./Models/LinkModel";
import { initMuteLedgerModel } from "./Models/MuteLedgerModel";
import { initNicknameLedgerModel } from "./Models/NicknameLedgerModel";
import { initPendingLinkModel } from "./Models/PendingLinkModel";
import { initTrackedMessageModel } from "./Models/TrackedMessageModel";
import { type AuditLogRepository, createAuditLogRepository } from "./Repositories/AuditLogRepository";
import { type BlockRepository, createBlockRepository } from "./Repositories/BlockRepository";
import { createGuildSecretRepository, type GuildSecretRepository } from "./Repositories/GuildSecretRepository";
import { createGuildSettingsRepository, type GuildSettingsRepository } from "./Repositories/GuildSettingsRepository";
import { createHostedGuildRepository, type HostedGuildRepository } from "./Repositories/HostedGuildRepository";
import { createLinkRepository, type LinkRepository } from "./Repositories/LinkRepository";
import { createMuteLedgerRepository, type MuteLedgerRepository } from "./Repositories/MuteLedgerRepository";
import { createNicknameLedgerRepository, type NicknameLedgerRepository } from "./Repositories/NicknameLedgerRepository";
import { createPendingLinkRepository, type PendingLinkRepository } from "./Repositories/PendingLinkRepository";
import { createTelemetryRepository, type TelemetryRepository } from "./Repositories/TelemetryRepository";
import { createTrackedMessageRepository, type TrackedMessageRepository } from "./Repositories/TrackedMessageRepository";

export interface Database {
    sequelize: Sequelize;
    links: LinkRepository;
    pendingLinks: PendingLinkRepository;
    muteLedger: MuteLedgerRepository;
    nicknameLedger: NicknameLedgerRepository;
    settings: GuildSettingsRepository;
    trackedMessages: TrackedMessageRepository;
    telemetry: TelemetryRepository;
    guildSecrets: GuildSecretRepository;
    hostedGuilds: HostedGuildRepository;
    blocks: BlockRepository;
    audit: AuditLogRepository;
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
        migrations: [
            initialMigration,
            guildSettingsMigration,
            pendingLinkLocaleMigration,
            trackedMessagesMigration,
            voiceLedgerMigration,
            linkFriendCodeMigration,
            nicknameLedgerMigration,
            botMetaMigration,
            guildSecretsMigration,
            hostedGuildsMigration,
            blocksMigration,
            auditLogMigration,
            ledgerSessionsMigration,
            hostedGuildLeftAtMigration,
        ],
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
    const nicknameLedgerModel = initNicknameLedgerModel(sequelize);
    const guildSettingsModel = initGuildSettingsModel(sequelize);
    const trackedMessageModel = initTrackedMessageModel(sequelize);

    return {
        sequelize,
        links: createLinkRepository(linkModel),
        pendingLinks: createPendingLinkRepository(pendingLinkModel),
        muteLedger: createMuteLedgerRepository(muteLedgerModel),
        nicknameLedger: createNicknameLedgerRepository(nicknameLedgerModel),
        settings: createGuildSettingsRepository(guildSettingsModel),
        trackedMessages: createTrackedMessageRepository(trackedMessageModel),
        telemetry: createTelemetryRepository(sequelize),
        guildSecrets: createGuildSecretRepository(sequelize),
        hostedGuilds: createHostedGuildRepository(sequelize),
        blocks: createBlockRepository(sequelize),
        audit: createAuditLogRepository(sequelize),
        close: () => sequelize.close(),
    };
}
